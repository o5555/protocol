require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const OURA_API_BASE = 'https://api.ouraring.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhsbkcvepvlqbygpmdpc.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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
            const body = await parseBody(req);
            const { userId, ouraToken, supabaseUrl, supabaseKey } = body;

            if (!userId || !ouraToken || !supabaseUrl || !supabaseKey) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing required fields: userId, ouraToken, supabaseUrl, supabaseKey' }));
                return;
            }

            // Fetch last 7 days of sleep data from Oura
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            const ouraPath = `/v2/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`;

            const ouraData = await new Promise((resolve, reject) => {
                const options = {
                    hostname: 'api.ouraring.com',
                    path: ouraPath,
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

            if (!ouraData.data || ouraData.data.length === 0) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ synced: 0, message: 'No sleep data found' }));
                return;
            }

            // Transform sleep data for Supabase
            // Oura can return multiple sessions per day (naps + main sleep),
            // so deduplicate by date, keeping the longest session
            const byDate = {};
            for (const sleep of ouraData.data) {
                const dur = sleep.total_sleep_duration || 0;
                if (!byDate[sleep.day] || dur > byDate[sleep.day].total_sleep_duration) {
                    byDate[sleep.day] = sleep;
                }
            }
            const sleepRecords = Object.values(byDate).map(sleep => ({
                user_id: userId,
                date: sleep.day,
                total_sleep_minutes: Math.round((sleep.total_sleep_duration || 0) / 60),
                deep_sleep_minutes: Math.round((sleep.deep_sleep_duration || 0) / 60),
                rem_sleep_minutes: Math.round((sleep.rem_sleep_duration || 0) / 60),
                light_sleep_minutes: Math.round((sleep.light_sleep_duration || 0) / 60),
                sleep_score: sleep.score || null,
                avg_hr: sleep.average_heart_rate || null
            }));

            // Upsert to Supabase
            const supabaseResponse = await new Promise((resolve, reject) => {
                const url = new URL('/rest/v1/sleep_data', supabaseUrl);
                const postData = JSON.stringify(sleepRecords);

                const options = {
                    hostname: url.hostname,
                    path: url.pathname + '?on_conflict=user_id,date',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`,
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

    // Health check endpoint
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
    }

    // Proxy requests to Oura API
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
    let filePath = req.url === '/' ? '/index.html' : req.url;

    // Remove query strings
    filePath = filePath.split('?')[0];

    filePath = path.join(__dirname, filePath);

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
║  Sleep Challenge - Oura Tracker                            ║
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
