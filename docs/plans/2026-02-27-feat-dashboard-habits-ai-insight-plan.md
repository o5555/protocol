---
title: Dashboard Habit Check-in + AI Daily Insight
type: feat
date: 2026-02-27
---

# feat: Dashboard Habit Check-in + AI Daily Insight

## Overview

Add two new sections below the swipeable Live Standings scoreboard on the dashboard:
1. **Daily Habit Check-in** — interactive checkboxes for the active challenge's protocol habits
2. **AI Coach Insight Card** — 2-3 sentence personalized feedback from Claude, regenerated once per day or after habit changes

The habit backend is fully built (`habit_completions` table, `toggleHabit()`, `getHabitCompletions()`). The AI insight uses Vercel AI Gateway (raw HTTPS, no npm deps).

## Problem Statement / Motivation

- The habit tracking system is fully built but has no convenient daily check-in UI — it's buried in the challenge detail page
- Users open the app each morning to check their score. Adding habit check-in and AI feedback here creates a complete morning ritual: see scores → check habits → get insight
- A static AI card keeps the dashboard scannable and fast (no chat)

## Proposed Solution

### Dashboard Flow (top to bottom)

```
[Live Standings — swipeable scores]        ← existing

[Last Night's Habits]                      ← NEW
  [x] No alcohol after 6pm
  [x] Screen off by 10pm
  [ ] Cold shower before bed
  2 of 3 completed

[AI Coach]                                 ← NEW
  "Your sleep score jumped to 86 — best
   this week. Skipping alcohol two nights
   in a row is showing results."
```

### Architecture

- **Habit check-in**: Client-side only. Reuses `Challenges.getHabitCompletions()` and `Challenges.toggleHabit()`. Rendered in `dashboard.js`.
- **AI insight**: Client POSTs context to `POST /api/ai/insight` → server.js forwards to Vercel AI Gateway → returns insight text. Client caches per `ai_insight_{challengeId}_{date}`.

## Technical Approach

### Phase 1: Habit Check-in on Dashboard

**Files:** `js/dashboard.js`, `index.html`

#### 1.1 Fetch habit data in `Dashboard.render()`

Add to the existing data fetch in `render()` and `_backgroundSync()`:

```javascript
// js/dashboard.js — inside render() data assembly
const challenge = activeChallenges[0]; // same one used for leagueData
if (challenge) {
  const today = DateUtils.toLocalDateStr(new Date());
  const [habits, completions] = await Promise.all([
    Protocols.getHabitsForMode(challenge.protocol_id, challenge.mode),
    Challenges.getHabitCompletions(challenge.id, user.id, today)
  ]);
  // Store for rendering
  this._habitData = { challenge, habits, completions, today };
}
```

#### 1.2 Render habit section in `_renderContent()`

Below the league scoreboard (or baseline card when no league data):

```javascript
// js/dashboard.js — new method
_renderHabitSection() {
  if (!this._habitData) return '';
  const { challenge, habits, completions, today } = this._habitData;
  if (!habits || habits.length === 0) return '';

  const completedIds = new Set(completions.map(c => c.habit_id));
  const completedCount = completedIds.size;

  return `
    <div class="bg-oura-card rounded-2xl p-4 border border-oura-border/30">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-white">Last Night's Habits</h3>
        <span class="text-xs text-oura-muted">${completedCount} of ${habits.length}</span>
      </div>
      <div class="space-y-2">
        ${habits.map(h => {
          const checked = completedIds.has(h.id);
          return `
            <button class="habit-check-row flex items-center gap-3 w-full text-left py-2"
                    data-habit-id="${h.id}" data-checked="${checked}"
                    role="checkbox" aria-checked="${checked}" aria-label="${h.title}">
              <div class="w-5 h-5 rounded border ${checked
                ? 'bg-oura-accent border-oura-accent'
                : 'border-oura-border'} flex items-center justify-center flex-shrink-0">
                ${checked ? '<svg class="w-3 h-3 text-black" ...check icon.../>' : ''}
              </div>
              <span class="text-sm ${checked ? 'text-white' : 'text-oura-muted'}">${h.title}</span>
            </button>`;
        }).join('')}
      </div>
    </div>`;
}
```

#### 1.3 Handle habit toggle on dashboard

```javascript
// js/dashboard.js — new method
async _handleDashboardHabitToggle(habitId) {
  const { challenge, today } = this._habitData;
  const row = document.querySelector(`[data-habit-id="${habitId}"]`);
  if (!row) return;

  const wasChecked = row.dataset.checked === 'true';

  // Optimistic UI update
  row.dataset.checked = String(!wasChecked);
  row.setAttribute('aria-checked', String(!wasChecked));
  // Update checkbox visual...

  try {
    await Challenges.toggleHabit(challenge.id, habitId, today);
    // Trigger debounced AI refresh
    this._scheduleAiRefresh();
  } catch (err) {
    // Revert on failure
    row.dataset.checked = String(wasChecked);
    row.setAttribute('aria-checked', String(wasChecked));
    // Revert checkbox visual...
  }
}
```

#### 1.4 Event delegation

```javascript
// In _renderContent() or after DOM insert
container.addEventListener('click', (e) => {
  const row = e.target.closest('.habit-check-row');
  if (row) this._handleDashboardHabitToggle(row.dataset.habitId);
});
```

### Phase 2: Server Route for AI Insight

**Files:** `server.js`

#### 2.1 Add `POST /api/ai/insight` route

**Critical:** Place BEFORE the Oura proxy catch-all (line ~881) to avoid being swallowed.

```javascript
// server.js — new route, before Oura proxy
if (url === '/api/ai/insight' && method === 'POST') {
  const body = await parseBody(req);
  const { sleepContext, habitContext, friendContext } = body;

  if (!sleepContext) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing sleep context' }));
  }

  const systemPrompt = `You are a supportive sleep coach. Be brief, data-driven, no fluff.
Give 2-3 sentences of personalized feedback based on the user's sleep data and habits.
If friend data is provided and notable, include a brief social nudge.`;

  const userMessage = [sleepContext, habitContext, friendContext]
    .filter(Boolean)
    .join('\n\n');

  const payload = JSON.stringify({
    model: 'anthropic/claude-haiku-4-5',
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_output_tokens: 200
  });

  const options = {
    hostname: 'ai-gateway.vercel.sh',
    path: '/v1/responses',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AI_GATEWAY_TOKEN}`,
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  // Raw https.request with 10s timeout
  const aiReq = https.request(options, (aiRes) => {
    let data = '';
    aiRes.on('data', chunk => data += chunk);
    aiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const text = parsed.output?.[0]?.content?.[0]?.text
                  || parsed.choices?.[0]?.message?.content
                  || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ insight: text }));
      } catch {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to parse AI response' }));
      }
    });
  });

  aiReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'AI service unavailable' }));
  });

  aiReq.setTimeout(10000, () => {
    aiReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'AI request timed out' }));
  });

  aiReq.write(payload);
  aiReq.end();
  return;
}
```

#### 2.2 Environment variable

- Variable name: `AI_GATEWAY_TOKEN`
- Value: The Vercel AI Gateway key (already provided)
- Add to `.env` locally and Vercel project settings for production

### Phase 3: AI Insight Card on Dashboard

**Files:** `js/dashboard.js`

#### 3.1 Build AI context from client data

```javascript
// js/dashboard.js — new method
_buildAiContext() {
  const { recentSleep, leagueData, habitData } = this;

  // Sleep context — last night + 7-day trend
  let sleepContext = '';
  if (recentSleep && recentSleep.length > 0) {
    const lastNight = recentSleep[0];
    const avg7 = this._avg7DaySleep(recentSleep);
    sleepContext = `Last night: sleep score ${lastNight.sleep_score}, avg HR ${lastNight.avg_hr} bpm, lowest HR ${lastNight.pre_sleep_hr} bpm, deep sleep ${lastNight.deep_sleep_minutes} min.
7-day averages: score ${avg7.score}, avg HR ${avg7.hr}, lowest HR ${avg7.low}, deep ${avg7.deep} min.`;
  }

  // Habit context
  let habitContext = '';
  if (this._habitData) {
    const { habits, completions } = this._habitData;
    const completed = completions.map(c => {
      const h = habits.find(h => h.id === c.habit_id);
      return h ? h.title : '';
    }).filter(Boolean);
    habitContext = `Habits completed today: ${completed.length} of ${habits.length}.`;
    if (completed.length > 0) habitContext += ` Done: ${completed.join(', ')}.`;
    const missed = habits.filter(h => !completions.find(c => c.habit_id === h.id)).map(h => h.title);
    if (missed.length > 0) habitContext += ` Missed: ${missed.join(', ')}.`;
  }

  // Friend context — only if someone has a standout result
  let friendContext = '';
  if (leagueData && leagueData.participants) {
    const friends = leagueData.participants.filter(p => !p.isMe);
    const me = leagueData.participants.find(p => p.isMe);
    const challengeAvgScore = Math.round(
      leagueData.participants.reduce((s, p) => s + (p.score || 0), 0) / leagueData.participants.length
    );
    const standout = friends.find(f => f.score && f.score >= challengeAvgScore + 10);
    if (standout) {
      friendContext = `Notable: ${standout.name} scored ${standout.score} (challenge avg ${challengeAvgScore}).`;
    }
  }

  return { sleepContext, habitContext, friendContext };
}
```

#### 3.2 Fetch and cache AI insight

```javascript
// js/dashboard.js — new method
async _fetchAiInsight(forceRefresh = false) {
  const challenge = this._habitData?.challenge;
  if (!challenge) return null;

  const today = DateUtils.toLocalDateStr(new Date());
  const cacheKey = `ai_insight_${challenge.id}_${today}`;

  // Check cache first (unless forced)
  if (!forceRefresh) {
    const cached = Cache.get(cacheKey);
    if (cached) return cached;
  }

  const context = this._buildAiContext();
  if (!context.sleepContext) return null; // No data, skip AI call

  try {
    const resp = await fetch('/api/ai/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context)
    });
    if (!resp.ok) return null;
    const { insight } = await resp.json();
    if (insight) Cache.set(cacheKey, insight);
    return insight;
  } catch {
    return null;
  }
}
```

#### 3.3 Render AI card

```javascript
// js/dashboard.js — new method
_renderAiCard(insight) {
  if (!insight) return '';
  return `
    <div class="bg-oura-card rounded-2xl p-4 border border-oura-border/30">
      <h3 class="text-sm font-semibold text-white mb-2">Daily Insight</h3>
      <p class="text-sm text-oura-muted leading-relaxed">${insight}</p>
    </div>`;
}

// Loading state placeholder
_renderAiCardLoading() {
  return `
    <div id="ai-card-slot" class="bg-oura-card rounded-2xl p-4 border border-oura-border/30">
      <h3 class="text-sm font-semibold text-white mb-2">Daily Insight</h3>
      <p class="text-sm text-oura-muted">Getting your daily insight...</p>
    </div>`;
}
```

#### 3.4 Debounced AI refresh after habit toggles

```javascript
// js/dashboard.js
_aiRefreshTimer: null,

_scheduleAiRefresh() {
  clearTimeout(this._aiRefreshTimer);
  this._aiRefreshTimer = setTimeout(async () => {
    const insight = await this._fetchAiInsight(true);
    const slot = document.getElementById('ai-card-slot');
    if (slot && insight) {
      slot.innerHTML = `
        <h3 class="text-sm font-semibold text-white mb-2">Daily Insight</h3>
        <p class="text-sm text-oura-muted leading-relaxed">${insight}</p>`;
    }
  }, 3000); // 3s debounce after last toggle
}
```

### Phase 4: Integration in Dashboard Render

Wire everything into `_renderContent()`:

```javascript
// js/dashboard.js — _renderContent() additions
_renderContent(container) {
  let html = '';

  // 1. League scoreboard or baseline (existing)
  if (this._leagueData) {
    html += this._renderLeaguePage(this._leagueData, this._leagueIndex);
  } else {
    html += this._renderBaseline();
  }

  // 2. Habit check-in (new) — only when active challenge exists
  html += this._renderHabitSection();

  // 3. AI insight card (new) — show loading placeholder, fill async
  if (this._habitData) {
    const cachedInsight = Cache.get(`ai_insight_${this._habitData.challenge.id}_${this._habitData.today}`);
    html += cachedInsight ? this._renderAiCard(cachedInsight) : this._renderAiCardLoading();
  }

  container.innerHTML = html;

  // Attach event listeners
  this._attachLeagueSwipe();
  this._attachHabitListeners(container);

  // Async: fetch AI insight if not cached
  if (this._habitData && !Cache.get(`ai_insight_${this._habitData.challenge.id}_${this._habitData.today}`)) {
    this._fetchAiInsight().then(insight => {
      const slot = document.getElementById('ai-card-slot');
      if (slot && insight) {
        slot.innerHTML = `
          <h3 class="text-sm font-semibold text-white mb-2">Daily Insight</h3>
          <p class="text-sm text-oura-muted leading-relaxed">${insight}</p>`;
      }
    });
  }
}
```

## Edge Cases & Decisions

| Scenario | Behavior |
|---|---|
| No active challenge | Habit section + AI card hidden |
| Multiple active challenges | Use `activeChallenges[0]` (same as league) |
| No sleep data | Habits still shown; AI card hidden (needs sleep context) |
| AI endpoint error/timeout | Card shows "Getting your daily insight..." then silently disappears or shows last cached |
| Rapid habit toggling | 3s debounce before AI re-fetch; generation counter guards against stale responses |
| Pull-to-refresh | Re-fetches habits; does NOT bust AI cache (once-per-day) |
| Upcoming challenge (day 0) | Habit section hidden (challenge not started) |
| Offline | Habits from cache; AI card shows cached insight or nothing |

## Acceptance Criteria

- [ ] Habit check-in section renders below Live Standings with correct habits for active challenge mode
- [ ] Tapping a habit checkbox toggles it (optimistic UI) and persists to `habit_completions`
- [ ] Toggle failure reverts checkbox to prior state
- [ ] Completion counter ("2 of 3") updates on toggle
- [ ] `POST /api/ai/insight` route returns 2-3 sentence insight from Claude
- [ ] AI card shows cached insight instantly on revisit (same day)
- [ ] AI card refreshes after habit toggle (3s debounce)
- [ ] AI card shows "Getting your daily insight..." while loading
- [ ] No habit section or AI card when no active challenge
- [ ] Route is placed before Oura proxy catch-all in server.js
- [ ] `AI_GATEWAY_TOKEN` env var is set
- [ ] No new npm dependencies
- [ ] Touch targets >= 44px on habit rows
- [ ] SW cache version bumped

## Dependencies & Risks

- **Vercel AI Gateway availability** — if the gateway goes down, the AI card silently fails (no impact on habits or standings)
- **AI cost** — using `claude-haiku-4-5` keeps cost minimal (~$0.001 per insight). With daily regeneration + habit-triggered refreshes, budget ~5-10 calls per user per day
- **Route ordering in server.js** — must be before Oura proxy catch-all or the route is silently swallowed

## References

### Internal
- Brainstorm: `docs/brainstorms/2026-02-27-dashboard-habits-ai-insight-brainstorm.md`
- Habit system: `js/challenges.js:483` (`getHabitCompletions`), `js/challenges.js:499` (`toggleHabit`)
- Protocol habits: `js/protocols.js:136` (`getHabitsForMode`)
- Dashboard render: `js/dashboard.js` (`render()`, `_renderContent()`, `_backgroundSync()`)
- Server route pattern: `server.js:238` (`/api/invite`), `server.js:815` (`/api/push/subscribe`)
- Cache module: `js/cache.js`

### External
- Vercel AI Gateway: `POST https://ai-gateway.vercel.sh/v1/responses` with Bearer token
- Model: `anthropic/claude-haiku-4-5` (cheapest, sufficient for 2-3 sentence output)
