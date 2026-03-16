---
title: Challenge Wrap-Up Experience
type: feat
date: 2026-03-16
---

# Challenge Wrap-Up Experience

## Overview

When a 30-day challenge ends, a full-screen swipeable card experience (5 cards) auto-shows on the user's first visit to the completed challenge. It walks them through results, AI-generated highlights, a personalized bedtime routine, and actionable takeaways. Revisitable anytime via a "View Wrap-Up" button on the detail page.

## Design Decisions (from brainstorm + spec analysis)

| Decision | Choice | Why |
|----------|--------|-----|
| "Seen" flag | Set on overlay open | Simple, matches `dismissed_summaries` pattern. If user force-quits mid-cards, they can reopen via button. |
| Dismiss | X button top-right on all cards | Users must be able to exit anytime, not just from Card 5. |
| AI format | Single API call, response has `## Highlights`, `## Routine`, `## Takeaways` sections | Parse by heading. Simpler than JSON — the AI is better at freeform markdown. |
| Loading | Cards 1-2 render instantly from local data. Cards 3-5 show skeleton until AI returns. | User sees something immediately while AI works. |
| Swipe | Copy league carousel touch handling, adapt for full-screen | Keep it simple — no shared utility (project philosophy). |
| Progress indicator | Dots at bottom (like league carousel) | Consistent with existing pattern. |
| Bedtime consistency | Show "avg bedtime" for baseline vs challenge (e.g. "23:45 → 22:30") | Simpler than std dev. More intuitive. |
| Desktop fallback | Arrow buttons + click on dots | Touch is primary, but clicks work. |
| Overlay stacking | z-50, guard against habit overlay | Check for wrap-up before showing habit overlay. |

## Card Content

### Card 1: Your Journey
- Challenge name + protocol name
- Date range (e.g. "Feb 14 – Mar 15")
- Nights tracked: `{n} of 30 nights`
- Participants count
- Mood: celebratory, simple

### Card 2: Your Numbers
Before → after for 4 metrics, computed from existing `myBaseline` / `myCurrent` data in `renderDetail()`:

| Metric | Source fields | Better = |
|--------|-------------|----------|
| Sleep score | `sleep_score` avg | Higher |
| Deep sleep | `deep_sleep_minutes` avg | Higher |
| Resting HR | `avg_hr` avg | Lower |
| Avg bedtime | `bedtime_start` avg | Earlier (but just show the time) |

Each metric shows: baseline value → challenge value, with a colored arrow (green = improved, red = declined, gray = unchanged). Use existing `calcImprovement` logic from `challenges.js:1137`.

### Card 3: Your Highlights (AI-generated)
3 personalized achievements. Parsed from `## Highlights` section of AI response. Rendered as 3 "award" cards with a short bold title + one sentence.

If AI is loading: 3 skeleton cards.
If AI failed: "Could not load your highlights" with a retry button.

### Card 4: Your Routine (AI-generated)
Personalized bedtime routine based on what correlated with good sleep during the challenge. Parsed from `## Routine` section. Rendered as a numbered list of 3-5 steps.

If AI is loading: skeleton lines.
If AI failed: fallback text "Review your challenge data to find what worked for you."

### Card 5: What's Next (AI-generated + static CTA)
Parsed from `## Takeaways` section — 3-4 compact bullet points.
Below: "Start a New Challenge" button → `App.navigateTo('challenges')` + dismiss overlay.

If AI failed: show only the CTA button.

## Files to Create

### `js/wrapup.js` — Wrap-up overlay logic

New file. Handles:
- `Wrapup.show(challengeData)` — builds overlay, starts AI fetch, attaches swipe
- `Wrapup.dismiss()` — fade-out + remove from DOM
- `Wrapup._renderCard(index)` — renders card content
- `Wrapup._attachSwipe(wrapper)` — horizontal swipe with direction locking (adapted from league carousel `_attachLeagueSwipe` in `dashboard.js:285-395`)
- `Wrapup._fetchAiWrapup(challengeData)` — POST to `/api/ai/wrapup`, cache result
- `Wrapup._parseAiResponse(text)` — split by `## Highlights`, `## Routine`, `## Takeaways`
- Touch handling: direction-lock after 8px, 20% threshold to advance, rubber-band at edges
- Dot navigation at bottom
- X button top-right

**Overlay structure:**
```html
<div id="wrapup-overlay" class="fixed inset-0 bg-oura-bg z-50 safe-area-overlay">
  <!-- X button -->
  <button class="absolute top-4 right-4 z-10 ..." aria-label="Close">×</button>
  <!-- Card viewport -->
  <div class="wrapup-clip overflow-hidden h-full">
    <div class="wrapup-track flex h-full" style="touch-action: pan-y">
      <div class="wrapup-card min-w-full h-full flex flex-col p-6 overflow-y-auto">
        <!-- Card content -->
      </div>
      <!-- ...more cards -->
    </div>
  </div>
  <!-- Dots -->
  <div class="absolute bottom-8 left-0 right-0 flex justify-center gap-2">
    <div class="w-2 h-2 rounded-full bg-oura-accent"></div>
    <div class="w-2 h-2 rounded-full bg-oura-muted/30"></div>
    <!-- ...more dots -->
  </div>
</div>
```

### `prompts/wrapup.md` — AI system prompt

```
You are a sleep coach writing a personalized end-of-challenge report.
You receive 30 days of baseline sleep data and 30 days of challenge data for one user.

Write three sections with these exact headings:

## Highlights

Pick the 3 most noteworthy things from this user's challenge.
Each highlight: a bold short title (3-6 words) + one sentence with a specific number or date.
Focus on real achievements backed by data — not generic praise.
If the data shows no improvement, acknowledge that honestly and find something positive
(e.g. consistency, a single great night, lowest HR achieved).

## Routine

Based on patterns in the data, suggest a personalized bedtime routine in 3-5 numbered steps.
Each step: one short sentence, actionable and specific.
Reference the user's actual optimal bedtime, best deep sleep times, or habits that correlated
with better sleep. Do not suggest things the data does not support.

## Takeaways

3-4 bullet points (start with "- ") summarizing what to keep doing.
Each takeaway: one sentence max, referencing a specific number or pattern from their data.

Rules:
- No emoji. No greetings. No sign-off.
- Be specific. Every sentence must reference actual data.
- Keep the total response under 300 words.
```

### `css/mobile.css` additions — Wrap-up card animations

```css
/* Wrap-up card entry */
@media (prefers-reduced-motion: no-preference) {
  .wrapup-track {
    transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
  }
}
```

## Files to Modify

### `js/challenges.js` — Hook wrap-up into renderDetail

At the end of `renderDetail()` (after line ~1477 where `_currentChallengeData` is set):

```js
// Show wrap-up on first visit to completed challenge
if (isCompleted && !localStorage.getItem('wrapup_seen_' + challenge.id)) {
  Wrapup.show({
    challenge,
    myBaseline,
    myCurrent,
    improvements,
    myData,       // full sleep data array
    sleepData,    // all participants
    leaderboard,
    habitProgress
  });
  localStorage.setItem('wrapup_seen_' + challenge.id, '1');
}
```

Also add a "View Wrap-Up" button in the completed challenge detail view (near the "Final Standings" heading):

```js
if (isCompleted) {
  // Add "View Wrap-Up" button above standings
  html += `<button onclick="Wrapup.show(Challenges._currentChallengeData)"
    class="w-full py-3 mb-4 bg-gradient-to-br from-oura-accent to-oura-accent-dark
    text-black font-semibold rounded-xl">View Wrap-Up</button>`;
}
```

### `js/dashboard.js` — Guard habit overlay against wrap-up

In `_shouldShowOverlay()` (line ~482), add guard:

```js
if (document.getElementById('wrapup-overlay')) return false;
```

### `server.js` — New API route

Add `POST /api/ai/wrapup` route (near existing `/api/ai/insight` at line ~982):

- Load `PROMPT_WRAPUP` from `prompts/wrapup.md` (already loaded at startup)
- Accept body: `{ sleepContext }` — the full baseline + challenge data summary
- Use `anthropic/claude-sonnet-4-6` via Vercel AI Gateway
- `max_output_tokens: 800` (longer than insight's 500 — three sections)
- Return `{ wrapup: text }`

### `index.html` — Add script tag

```html
<script src="js/wrapup.js"></script>
```

### `sw.js` — Bump cache version

Bump `CACHE_NAME` (e.g. `pc-v15` → `pc-v16`).

## Context Sent to AI

Build a compact summary (not raw JSON of 60 nights). Similar to `_buildAiContext` but retrospective:

```
CHALLENGE: "30-Day Sleep Protocol" (Feb 14 – Mar 15, 30 days)

BASELINE (30 nights before challenge):
Avg sleep score: 72, Avg deep: 68 min, Avg HR: 58, Avg bedtime: 23:45

CHALLENGE PERIOD (28 nights with data out of 30):
Avg sleep score: 78, Avg deep: 82 min, Avg HR: 55, Avg bedtime: 22:50

BEST NIGHTS:
- Mar 2: score 92, deep 128 min, bedtime 22:15
- Feb 28: score 89, deep 115 min, bedtime 22:30

WORST NIGHTS:
- Feb 20: score 58, deep 32 min, bedtime 01:15
- Mar 8: score 61, deep 41 min, bedtime 00:45

BEDTIME PATTERN:
Before 23:00: 18 nights (avg score 81, avg deep 91 min)
After 23:00: 10 nights (avg score 68, avg deep 58 min)

HABIT COMPLETIONS:
- "No screens 1hr before bed": completed 22/28 days
- "Magnesium before bed": completed 25/28 days
- "10 min morning sunlight": completed 15/28 days
```

This gives the AI rich, pre-computed context without sending raw data for 60 nights.

## Edge Cases

| Case | Handling |
|------|----------|
| Zero challenge data | Skip wrap-up entirely. Don't show button. |
| <5 nights of data | Show wrap-up but AI prompt gets a note: "Limited data — be honest about the sample size." |
| AI call fails | Cards 1-2 show normally. Cards 3-5 show fallback text + retry button. |
| AI call slow (>5s) | Skeleton shimmer on cards 3-5. User can still view cards 1-2. |
| Offline | Cards 1-2 from cached data. Cards 3-5 show "You're offline" with note to revisit later. |
| Habit overlay conflict | Guard in `_shouldShowOverlay()` checks for `wrapup-overlay`. |
| localStorage full | Wrap fails silently (try/catch). AI re-fetches on next visit. |
| Pull-to-refresh while overlay showing | No conflict — overlay is `fixed` and covers the scroll container. |
| Back button | Wrap-up does NOT push to history. Back dismisses the overlay (add popstate listener). |
| Fresh-start challenge | Use `fresh_start_at` as the real start date for baseline/challenge split. |
| Multiple devices | Wrap-up auto-shows again on new device (no server-side "seen" state). Acceptable. |

## Implementation Order

1. **Prompt file** — Create `prompts/wrapup.md`, add `PROMPT_WRAPUP` to server.js startup
2. **Server route** — Add `POST /api/ai/wrapup` (copy insight route pattern)
3. **Wrapup module** — Create `js/wrapup.js` with overlay, cards 1-2, swipe, dots, dismiss
4. **AI integration** — Add fetch, caching, response parsing, cards 3-5 with loading/error states
5. **Hook into challenges.js** — Auto-show on first completed visit, "View Wrap-Up" button
6. **Guards** — Habit overlay guard, back-button handling
7. **Polish** — Animations, safe areas, reduced-motion, test on iPhone

## Acceptance Criteria

- [x] First visit to completed challenge auto-shows wrap-up overlay
- [x] 5 swipeable cards with dot indicators
- [x] Cards 1-2 render from local data (no loading)
- [x] Cards 3-5 render AI-generated content with loading skeletons
- [x] AI response cached per challenge ID in localStorage
- [x] "View Wrap-Up" button on detail page for revisiting
- [x] X button dismisses overlay from any card
- [x] Swipe works on iPhone (direction-locked, rubber-band edges)
- [x] Dots update on card change, clickable
- [x] "Start a New Challenge" CTA on Card 5 navigates to challenges page
- [x] Habit overlay does not show while wrap-up is open
- [x] Respects `prefers-reduced-motion`
- [x] Dark theme, safe areas, 44px+ touch targets
- [x] Graceful degradation when AI fails or user is offline

## References

- Brainstorm: `docs/brainstorms/2026-03-16-challenge-wrap-up-brainstorm.md`
- Habit overlay pattern: `js/dashboard.js:497-620`
- League swipe pattern: `js/dashboard.js:285-395`
- AI insight route: `server.js:982-1080`
- AI insight prompt: `prompts/ai-insight.md`
- Challenge completion detection: `js/challenges.js:1214`
- Challenge data assembly: `js/challenges.js:1477`
- Improvement calc: `js/challenges.js:1137-1149`
- Safe area overlay CSS: `css/mobile.css:57-60`
- Onboarding step animation: `css/mobile.css:144-153`
