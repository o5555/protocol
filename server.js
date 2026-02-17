require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const OURA_API_BASE = 'https://api.ouraring.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhsbkcvepvlqbygpmdpc.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const WEBHOOK_SECRET = (process.env.WEBHOOK_SECRET || '').trim();
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_EMAIL = (process.env.VAPID_EMAIL || 'mailto:hello@protocolcircle.com').trim();

let webpush;
try {
    webpush = require('web-push');
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
        webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    }
} catch (e) {
    console.warn('web-push not available, push notifications disabled');
}

function toLocalDateStr(d) {
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

// Parse JSON body from request
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }


    // Webhook endpoint for sleep data sync
    // This can be called by a cron job or external service
    if (req.url === '/webhook/sync-sleep' && req.method === 'POST') {
        try {
            // Authenticate webhook requests via shared secret
            const authHeader = req.headers['authorization'] || '';
            const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
            if (!WEBHOOK_SECRET || token !== WEBHOOK_SECRET) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }

            const body = await parseBody(req);
            const { userId, ouraToken } = body;

            if (!userId || !ouraToken) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing required fields: userId, ouraToken' }));
                return;
            }

            if (!SUPABASE_SERVICE_ROLE_KEY) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server not configured: missing SUPABASE_SERVICE_ROLE_KEY' }));
                return;
            }

            // Fetch last 7 days of sleep data from Oura
            const endDate = toLocalDateStr(new Date());
            const startDate = toLocalDateStr(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

            const ouraPath = `/v2/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`;
            const ouraDailyPath = `/v2/usercollection/daily_sleep?start_date=${startDate}&end_date=${endDate}`;

            // Helper to fetch from Oura API
            const fetchOura = (apiPath) => new Promise((resolve, reject) => {
                const options = {
                    hostname: 'api.ouraring.com',
                    path: apiPath,
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${ouraToken}`,
                        'Content-Type': 'application/json'
                    }
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error('Failed to parse Oura response'));
                        }
                    });
                });

                req.on('error', reject);
                req.end();
            });

            // Fetch sleep sessions and daily sleep scores in parallel
            const [ouraData, dailySleepData] = await Promise.all([
                fetchOura(ouraPath),
                fetchOura(ouraDailyPath).catch(() => ({ data: [] }))
            ]);

            if (!ouraData.data || ouraData.data.length === 0) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ synced: 0, message: 'No sleep data found' }));
                return;
            }

            // Build daily sleep score lookup
            const scoresByDay = {};
            for (const d of (dailySleepData.data || [])) {
                scoresByDay[d.day] = d.score;
            }

            // Transform sleep data for Supabase
            // Oura can return multiple sessions per day (naps + main sleep),
            // so group by date and SUM durations across all sessions,
            // taking HR metrics from the primary (longest long_sleep) session
            const sessionsByDate = {};
            for (const sleep of ouraData.data) {
                if (!sessionsByDate[sleep.day]) sessionsByDate[sleep.day] = [];
                sessionsByDate[sleep.day].push(sleep);
            }
            const sleepRecords = Object.entries(sessionsByDate).map(([day, sessions]) => {
                const primary = [...sessions].sort((a, b) => {
                    const aLong = a.type === 'long_sleep' ? 1 : 0;
                    const bLong = b.type === 'long_sleep' ? 1 : 0;
                    if (aLong !== bLong) return bLong - aLong;
                    return (b.total_sleep_duration || 0) - (a.total_sleep_duration || 0);
                })[0];
                const totalSleep = sessions.reduce((sum, s) => sum + (s.total_sleep_duration || 0), 0);
                const deepSleep = sessions.reduce((sum, s) => sum + (s.deep_sleep_duration || 0), 0);
                const remSleep = sessions.reduce((sum, s) => sum + (s.rem_sleep_duration || 0), 0);
                const lightSleep = sessions.reduce((sum, s) => sum + (s.light_sleep_duration || 0), 0);
                return {
                    user_id: userId,
                    date: day,
                    total_sleep_minutes: Math.round(totalSleep / 60),
                    deep_sleep_minutes: Math.round(deepSleep / 60),
                    rem_sleep_minutes: Math.round(remSleep / 60),
                    light_sleep_minutes: Math.round(lightSleep / 60),
                    sleep_score: scoresByDay[day] || null,
                    avg_hr: primary.average_heart_rate || null,
                    pre_sleep_hr: primary.lowest_heart_rate || null,
                    bedtime_start: primary.bedtime_start || null
                };
            });

            // Upsert to Supabase using server-side credentials
            const supabaseResponse = await new Promise((resolve, reject) => {
                const url = new URL('/rest/v1/sleep_data', SUPABASE_URL);
                const postData = JSON.stringify(sleepRecords);

                const options = {
                    hostname: url.hostname,
                    path: url.pathname + '?on_conflict=user_id,date',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        'Prefer': 'resolution=merge-duplicates',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve({ status: res.statusCode, data }));
                });

                req.on('error', reject);
                req.write(postData);
                req.end();
            });

            if (supabaseResponse.status >= 200 && supabaseResponse.status < 300) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    synced: sleepRecords.length,
                    message: `Successfully synced ${sleepRecords.length} nights of sleep data`
                }));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Failed to save to Supabase',
                    details: supabaseResponse.data
                }));
            }
        } catch (error) {
            console.error('Webhook error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Send invite email to a new user via Supabase Auth
    if (req.url === '/api/invite' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { email } = body;

            if (!email) {
                console.error('[invite] Missing email in request body');
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing email' }));
                return;
            }

            if (!SUPABASE_SERVICE_ROLE_KEY) {
                console.error('[invite] SUPABASE_SERVICE_ROLE_KEY is not configured');
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }));
                return;
            }

            console.log(`[invite] Sending invite to ${email}`);

            const inviteData = JSON.stringify({ email });
            const url = new URL('/auth/v1/invite', SUPABASE_URL);

            const inviteRes = await new Promise((resolve, reject) => {
                const options = {
                    hostname: url.hostname,
                    path: url.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        'Content-Length': Buffer.byteLength(inviteData)
                    }
                };

                const r = https.request(options, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => resolve({ status: response.statusCode, data }));
                });

                r.on('error', reject);
                r.write(inviteData);
                r.end();
            });

            if (inviteRes.status >= 200 && inviteRes.status < 300) {
                console.log(`[invite] Success for ${email}: ${inviteRes.data}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Invite email sent' }));
            } else {
                console.error(`[invite] Failed for ${email}: status=${inviteRes.status} body=${inviteRes.data}`);
                res.writeHead(inviteRes.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to send invite', details: inviteRes.data }));
            }
        } catch (error) {
            console.error(`[invite] Exception:`, error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Send magic link to an existing user (serves as challenge invite notification)
    if (req.url === '/api/notify-invite' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { email } = body;

            if (!email) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing email' }));
                return;
            }

            if (!SUPABASE_SERVICE_ROLE_KEY) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }));
                return;
            }

            console.log(`[notify-invite] Sending magic link to ${email}`);

            const otpData = JSON.stringify({ email });
            const url = new URL('/auth/v1/otp', SUPABASE_URL);

            const otpRes = await new Promise((resolve, reject) => {
                const options = {
                    hostname: url.hostname,
                    path: url.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        'Content-Length': Buffer.byteLength(otpData)
                    }
                };

                const r = https.request(options, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => resolve({ status: response.statusCode, data }));
                });

                r.on('error', reject);
                r.write(otpData);
                r.end();
            });

            if (otpRes.status >= 200 && otpRes.status < 300) {
                console.log(`[notify-invite] Magic link sent to ${email}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                console.error(`[notify-invite] Failed for ${email}: status=${otpRes.status} body=${otpRes.data}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, details: otpRes.data }));
            }
        } catch (error) {
            console.error(`[notify-invite] Exception:`, error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Health check endpoint
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
    }

    // Bug report endpoint - saves to Supabase and forwards to Telegram
    // (must be before the /api/* proxy catch-all)
    if (req.url === '/api/bug-report' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { message, screen, deviceInfo, errorLog, userEmail } = body;

            if (!message) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Message is required' }));
                return;
            }

            // Forward to Telegram if configured
            const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
            const chatId = process.env.TELEGRAM_CHAT_ID || '';

            if (botToken && chatId) {
                const text = [
                    '\u{1F41B} <b>Bug Report</b>',
                    '',
                    `<b>From:</b> ${userEmail || 'Unknown'}`,
                    `<b>Screen:</b> ${screen || 'Unknown'}`,
                    '',
                    message,
                    '',
                    deviceInfo ? `<i>${deviceInfo.browser || ''} \u{2022} ${deviceInfo.screenSize || ''}</i>` : '',
                    errorLog ? `\n<pre>${errorLog.slice(0, 500)}</pre>` : ''
                ].filter(Boolean).join('\n');

                const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });

                const telegramReq = https.request({
                    hostname: 'api.telegram.org',
                    path: `/bot${botToken}/sendMessage`,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                }, (telegramRes) => {
                    let d = '';
                    telegramRes.on('data', c => d += c);
                    telegramRes.on('end', () => {
                        if (telegramRes.statusCode >= 300) console.error('[bug-report] Telegram error:', d);
                    });
                });
                telegramReq.on('error', (e) => console.error('[bug-report] Telegram error:', e.message));
                telegramReq.write(payload);
                telegramReq.end();
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            console.error('[bug-report] Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Cron endpoint: sync sleep data for ALL active challenge participants
    if (req.url.split('?')[0] === '/api/cron/sync-sleep' && (req.method === 'GET' || req.method === 'POST')) {
        try {
            const authHeader = req.headers['authorization'] || '';
            const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
            const validSecret = (WEBHOOK_SECRET && token === WEBHOOK_SECRET) ||
                                (CRON_SECRET && token === CRON_SECRET);
            if (!validSecret) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }

            if (!SUPABASE_SERVICE_ROLE_KEY) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server not configured: missing SUPABASE_SERVICE_ROLE_KEY' }));
                return;
            }

            console.log('[cron-sync] Starting sleep sync for active challenges');

            // Helper: make a Supabase REST GET request
            const supabaseGet = (restPath) => new Promise((resolve, reject) => {
                const url = new URL(restPath, SUPABASE_URL);
                const options = {
                    hostname: url.hostname,
                    path: url.pathname + url.search,
                    method: 'GET',
                    headers: {
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        'Content-Type': 'application/json'
                    }
                };
                const r = https.request(options, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error(`Failed to parse Supabase response: ${data.slice(0, 200)}`));
                        }
                    });
                });
                r.on('error', reject);
                r.end();
            });

            // Helper: fetch from Oura API with a given token
            const fetchOura = (apiPath, ouraToken) => new Promise((resolve, reject) => {
                const options = {
                    hostname: 'api.ouraring.com',
                    path: apiPath,
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${ouraToken}`,
                        'Content-Type': 'application/json'
                    }
                };
                const r = https.request(options, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error('Failed to parse Oura response'));
                        }
                    });
                });
                r.on('error', reject);
                r.end();
            });

            // 1. Get active challenges (start_date <= today AND end_date >= today)
            const today = toLocalDateStr(new Date());
            const challenges = await supabaseGet(
                `/rest/v1/challenges?start_date=lte.${today}&end_date=gte.${today}&select=id,start_date,end_date`
            );

            if (!Array.isArray(challenges) || challenges.length === 0) {
                console.log('[cron-sync] No active challenges found');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ synced: [], errors: [], total: 0, message: 'No active challenges' }));
                return;
            }

            console.log(`[cron-sync] Found ${challenges.length} active challenge(s)`);

            // 2. Get accepted participants for those challenges
            const challengeIds = challenges.map(c => c.id).join(',');
            const participants = await supabaseGet(
                `/rest/v1/challenge_participants?challenge_id=in.(${challengeIds})&status=eq.accepted&select=user_id,challenge_id`
            );

            if (!Array.isArray(participants) || participants.length === 0) {
                console.log('[cron-sync] No accepted participants found');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ synced: [], errors: [], total: 0, message: 'No accepted participants' }));
                return;
            }

            // 3. Get unique user IDs and their oura_tokens from profiles
            const uniqueUserIds = [...new Set(participants.map(p => p.user_id))];
            const profiles = await supabaseGet(
                `/rest/v1/profiles?id=in.(${uniqueUserIds.join(',')})&select=id,oura_token`
            );

            if (!Array.isArray(profiles)) {
                console.error('[cron-sync] Failed to fetch profiles');
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to fetch profiles' }));
                return;
            }

            // Build a map of userId -> oura_token, filter out those without tokens
            const tokenMap = {};
            for (const p of profiles) {
                if (p.oura_token) tokenMap[p.id] = p.oura_token;
            }

            // Build a map of userId -> challenge info for date range calculation
            const userChallenges = {};
            for (const p of participants) {
                if (!userChallenges[p.user_id]) userChallenges[p.user_id] = [];
                const challenge = challenges.find(c => c.id === p.challenge_id);
                if (challenge) userChallenges[p.user_id].push(challenge);
            }

            const usersToSync = Object.keys(tokenMap);
            console.log(`[cron-sync] ${usersToSync.length} user(s) with Oura tokens to sync`);

            const synced = [];
            const errors = [];

            // 4. Process each user sequentially to avoid Oura rate limits
            for (const userId of usersToSync) {
                try {
                    const ouraToken = tokenMap[userId];
                    const userChals = userChallenges[userId] || [];

                    // Calculate date range: earliest challenge start - 90 days to today
                    // (expanded window to handle gaps like lost rings)
                    const earliestStart = userChals.reduce((earliest, c) => {
                        return c.start_date < earliest ? c.start_date : earliest;
                    }, today);
                    const baselineDate = new Date(earliestStart);
                    baselineDate.setDate(baselineDate.getDate() - 90);
                    const startDate = toLocalDateStr(baselineDate);
                    // +1 day because Oura end_date is exclusive
                    const endTomorrow = new Date();
                    endTomorrow.setDate(endTomorrow.getDate() + 1);
                    const endDate = toLocalDateStr(endTomorrow);

                    console.log(`[cron-sync] Syncing user ${userId}: ${startDate} to ${endDate}`);

                    // Fetch sleep sessions and daily sleep scores in parallel
                    const [ouraData, dailySleepData] = await Promise.all([
                        fetchOura(`/v2/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`, ouraToken),
                        fetchOura(`/v2/usercollection/daily_sleep?start_date=${startDate}&end_date=${endDate}`, ouraToken)
                            .catch(() => ({ data: [] }))
                    ]);

                    if (!ouraData.data || ouraData.data.length === 0) {
                        console.log(`[cron-sync] No sleep data for user ${userId}`);
                        synced.push({ userId, nights: 0 });
                        continue;
                    }

                    // Build daily sleep score lookup
                    const scoresByDay = {};
                    for (const d of (dailySleepData.data || [])) {
                        scoresByDay[d.day] = d.score;
                    }

                    // Group by date and SUM durations across all sessions,
                    // taking HR metrics from the primary (longest long_sleep) session
                    const sessionsByDate = {};
                    for (const sleep of ouraData.data) {
                        if (!sessionsByDate[sleep.day]) sessionsByDate[sleep.day] = [];
                        sessionsByDate[sleep.day].push(sleep);
                    }

                    // Transform to sleep_data records
                    const sleepRecords = Object.entries(sessionsByDate).map(([day, sessions]) => {
                        const primary = [...sessions].sort((a, b) => {
                            const aLong = a.type === 'long_sleep' ? 1 : 0;
                            const bLong = b.type === 'long_sleep' ? 1 : 0;
                            if (aLong !== bLong) return bLong - aLong;
                            return (b.total_sleep_duration || 0) - (a.total_sleep_duration || 0);
                        })[0];
                        const totalSleep = sessions.reduce((sum, s) => sum + (s.total_sleep_duration || 0), 0);
                        const deepSleep = sessions.reduce((sum, s) => sum + (s.deep_sleep_duration || 0), 0);
                        const remSleep = sessions.reduce((sum, s) => sum + (s.rem_sleep_duration || 0), 0);
                        const lightSleep = sessions.reduce((sum, s) => sum + (s.light_sleep_duration || 0), 0);
                        return {
                            user_id: userId,
                            date: day,
                            total_sleep_minutes: Math.round(totalSleep / 60),
                            deep_sleep_minutes: Math.round(deepSleep / 60),
                            rem_sleep_minutes: Math.round(remSleep / 60),
                            light_sleep_minutes: Math.round(lightSleep / 60),
                            sleep_score: scoresByDay[day] || null,
                            avg_hr: primary.average_heart_rate || null,
                            pre_sleep_hr: primary.lowest_heart_rate || null,
                            bedtime_start: primary.bedtime_start || null
                        };
                    });

                    // Upsert to Supabase
                    const postData = JSON.stringify(sleepRecords);
                    const upsertResult = await new Promise((resolve, reject) => {
                        const url = new URL('/rest/v1/sleep_data', SUPABASE_URL);
                        const options = {
                            hostname: url.hostname,
                            path: url.pathname + '?on_conflict=user_id,date',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                                'Prefer': 'resolution=merge-duplicates',
                                'Content-Length': Buffer.byteLength(postData)
                            }
                        };
                        const r = https.request(options, (response) => {
                            let data = '';
                            response.on('data', chunk => data += chunk);
                            response.on('end', () => resolve({ status: response.statusCode, data }));
                        });
                        r.on('error', reject);
                        r.write(postData);
                        r.end();
                    });

                    if (upsertResult.status >= 200 && upsertResult.status < 300) {
                        console.log(`[cron-sync] Synced ${sleepRecords.length} nights for user ${userId}`);
                        synced.push({ userId, nights: sleepRecords.length });
                    } else {
                        console.error(`[cron-sync] Supabase upsert failed for user ${userId}: ${upsertResult.data}`);
                        errors.push({ userId, error: `Supabase upsert failed: ${upsertResult.status}` });
                    }
                } catch (userError) {
                    console.error(`[cron-sync] Error syncing user ${userId}:`, userError.message);
                    errors.push({ userId, error: userError.message });
                }
            }

            // === Leaderboard notification: check if all participants have data for today ===
            if (webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
                try {
                    for (const challenge of challenges) {
                        const challengeParticipants = participants.filter(p => p.challenge_id === challenge.id);
                        const participantUserIds = challengeParticipants.map(p => p.user_id);

                        if (participantUserIds.length === 0) continue;

                        // Check if we already sent this notification today
                        const existingNotif = await supabaseGet(
                            `/rest/v1/notification_log?challenge_id=eq.${challenge.id}&notification_type=eq.leaderboard_ready&sleep_date=eq.${today}&select=id&limit=1`
                        );

                        if (Array.isArray(existingNotif) && existingNotif.length > 0) {
                            console.log(`[cron-notify] Already notified for challenge ${challenge.id} on ${today}`);
                            continue;
                        }

                        // Check if all participants have sleep data for today
                        const sleepDataToday = await supabaseGet(
                            `/rest/v1/sleep_data?user_id=in.(${participantUserIds.join(',')})&date=eq.${today}&select=user_id`
                        );

                        const usersWithData = new Set((sleepDataToday || []).map(d => d.user_id));
                        const allHaveData = participantUserIds.every(uid => usersWithData.has(uid));

                        if (!allHaveData) {
                            const missing = participantUserIds.filter(uid => !usersWithData.has(uid)).length;
                            console.log(`[cron-notify] Challenge ${challenge.id}: ${missing}/${participantUserIds.length} participants still missing data for ${today}`);
                            continue;
                        }

                        console.log(`[cron-notify] All ${participantUserIds.length} participants have data for ${today} in challenge ${challenge.id}. Sending notifications...`);

                        // Get push subscriptions for all participants
                        const subscriptions = await supabaseGet(
                            `/rest/v1/push_subscriptions?user_id=in.(${participantUserIds.join(',')})&select=endpoint,p256dh,auth,user_id`
                        );

                        if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
                            console.log('[cron-notify] No push subscriptions found for participants');
                        } else {
                            const payload = JSON.stringify({
                                title: 'All data is in!',
                                body: 'See where you stand on the leaderboard and prepare for a great night of sleep.',
                                page: 'challenge-detail',
                                challengeId: challenge.id
                            });

                            let sent = 0, failed = 0;
                            for (const sub of subscriptions) {
                                try {
                                    await webpush.sendNotification({
                                        endpoint: sub.endpoint,
                                        keys: { p256dh: sub.p256dh, auth: sub.auth }
                                    }, payload);
                                    sent++;
                                } catch (pushErr) {
                                    failed++;
                                    console.error(`[cron-notify] Push failed for user ${sub.user_id}:`, pushErr.message);
                                    // If subscription is expired/invalid (410 Gone or 404), remove it
                                    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                                        await new Promise((resolve) => {
                                            const url = new URL(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, SUPABASE_URL);
                                            const options = {
                                                hostname: url.hostname,
                                                path: url.pathname + url.search,
                                                method: 'DELETE',
                                                headers: {
                                                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                                                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                                                }
                                            };
                                            const r = https.request(options, () => resolve());
                                            r.on('error', () => resolve());
                                            r.end();
                                        });
                                    }
                                }
                            }
                            console.log(`[cron-notify] Push results: ${sent} sent, ${failed} failed`);
                        }

                        // Log notification to prevent re-sending
                        const logData = JSON.stringify({
                            challenge_id: challenge.id,
                            notification_type: 'leaderboard_ready',
                            sleep_date: today
                        });
                        await new Promise((resolve) => {
                            const url = new URL('/rest/v1/notification_log', SUPABASE_URL);
                            const options = {
                                hostname: url.hostname,
                                path: url.pathname + '?on_conflict=challenge_id,notification_type,sleep_date',
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                                    'Prefer': 'resolution=merge-duplicates',
                                    'Content-Length': Buffer.byteLength(logData)
                                }
                            };
                            const r = https.request(options, () => resolve());
                            r.on('error', () => resolve());
                            r.write(logData);
                            r.end();
                        });
                    }
                } catch (notifyErr) {
                    console.error('[cron-notify] Notification check error:', notifyErr.message);
                }
            }

            console.log(`[cron-sync] Done. Synced: ${synced.length}, Errors: ${errors.length}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ synced, errors, total: usersToSync.length }));
        } catch (error) {
            console.error('[cron-sync] Fatal error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Push notification endpoints
    if (req.url === '/api/push/vapid-key' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ publicKey: VAPID_PUBLIC_KEY }));
        return;
    }

    if (req.url === '/api/push/subscribe' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { subscription, userId } = body;

            if (!subscription || !userId || !subscription.endpoint || !subscription.keys) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing subscription or userId' }));
                return;
            }

            if (!SUPABASE_SERVICE_ROLE_KEY) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server not configured' }));
                return;
            }

            // Upsert push subscription to Supabase
            const subData = JSON.stringify({
                user_id: userId,
                endpoint: subscription.endpoint,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth
            });

            const upsertResult = await new Promise((resolve, reject) => {
                const url = new URL('/rest/v1/push_subscriptions', SUPABASE_URL);
                const options = {
                    hostname: url.hostname,
                    path: url.pathname + '?on_conflict=user_id,endpoint',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        'Prefer': 'resolution=merge-duplicates',
                        'Content-Length': Buffer.byteLength(subData)
                    }
                };
                const r = https.request(options, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => resolve({ status: response.statusCode, data }));
                });
                r.on('error', reject);
                r.write(subData);
                r.end();
            });

            if (upsertResult.status >= 200 && upsertResult.status < 300) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } else {
                console.error('[push] Subscription save failed:', upsertResult.data);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to save subscription' }));
            }
        } catch (err) {
            console.error('[push] Subscribe error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // Proxy requests to Oura API (catch-all for /api/*)
    if (req.url.startsWith('/api/')) {
        const ouraPath = req.url.replace('/api', '/v2/usercollection');
        const ouraUrl = new URL(ouraPath, OURA_API_BASE);

        const options = {
            hostname: ouraUrl.hostname,
            path: ouraUrl.pathname + ouraUrl.search,
            method: req.method,
            headers: {
                'Authorization': req.headers.authorization || '',
                'Content-Type': 'application/json'
            }
        };

        const proxyReq = https.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            console.error('Proxy error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });

        proxyReq.end();
        return;
    }

    // Serve static files
    // Remove query strings first, then check for root
    let filePath = req.url.split('?')[0];
    if (filePath === '/') filePath = '/index.html';

    // Decode URI components and resolve to absolute path
    filePath = path.resolve(__dirname, '.' + decodeURIComponent(filePath));

    // Block path traversal: ensure resolved path is within __dirname
    if (!filePath.startsWith(__dirname + path.sep) && filePath !== __dirname) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // Block dotfiles (e.g. .env, .git, .gitignore)
    const relativePath = path.relative(__dirname, filePath);
    if (relativePath.split(path.sep).some(segment => segment.startsWith('.'))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  Protocol - Oura Tracker                                   ║
╠════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                  ║
║  Open this URL in your browser to use the app              ║
║                                                            ║
║  Endpoints:                                                ║
║  - GET  /              Web application                     ║
║  - GET  /api/*         Oura API proxy                      ║
║  - POST /webhook/sync-sleep  Sync sleep data               ║
║  - GET  /health        Health check                        ║
╚════════════════════════════════════════════════════════════╝
`);
});
