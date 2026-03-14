# AI Insight Gating — Design Spec

## Problem

When a user opens Protocol Circle during an active challenge, the AI insight generates as soon as sleep data is available — without waiting for habit check-in. This produces lower-quality insights that miss half the context. Additionally, there is no "waiting" state when sleep data hasn't synced, leaving an empty gap on the dashboard.

## Solution

Gate AI insight generation behind a habit check-in overlay. Show contextual waiting states when sleep data is unavailable.

---

## 1. Habit Check-In Overlay

### Trigger Conditions (all must be true)

- User has an active challenge
- Yesterday falls within the challenge date range (not the first day)
- User has NOT checked in habits for yesterday (check localStorage lock + DB completions)

### Timing

Shown after challenge data loads (not truly "immediately" — requires async fetch of active challenges and habit completions). The overlay appears as soon as the trigger conditions can be evaluated. No time-of-day restriction — if the user hasn't checked in, they see the overlay regardless of when they open the app. Deep-links to the dashboard are not exempt; the overlay still fires since it is quick to complete or skip.

### Overlay Not Shown When

- No active challenge
- First day of challenge (no "yesterday" to check in)
- Already checked in (localStorage lock or DB completions)
- Already skipped this session (`Dashboard._overlaySkippedToday === true`)
- Challenge protocol has zero habits

### Layout

- Full-screen opaque overlay using `bg-oura-bg` with safe-area padding
- Heading: "Yesterday's Habits" with the formatted date
- List of protocol habits filtered by challenge mode (light/pro) as toggle rows
- Each row: habit name + toggle (same interaction as current dashboard check-in)
- Bottom: primary CTA "Confirm" + secondary "Skip for now" text link below
- Pre-seeded with any existing DB data (handles partial state from prior sessions)

### On Confirm

1. Save habits to DB via `Challenges.saveHabitBatch()`
2. Set localStorage lock: `habit_checkin_${challengeId}_${date}`
3. Animate overlay out (fade or slide down, ~200ms)
4. Dashboard revealed underneath (loaded in parallel during overlay)

### On Skip

1. Set session-scoped flag: `Dashboard._overlaySkippedToday = true` (in-memory, survives tab switches but resets on full app restart — giving users another chance on fresh opens)
2. Overlay dismissed immediately, no habit data saved
3. Dashboard habit section available as collapsed fallback (expandable)
4. AI insight generates without habit data (same as current behavior)

### On Save Failure

1. Show error toast: "Couldn't save your habits. Try again."
2. Re-enable Confirm button (don't dismiss overlay)
3. User can retry or tap Skip

### Overlay and AI Suppression

While the overlay is visible, AI insight rendering is fully suppressed via `Dashboard._overlayPending = true`. The dashboard loads data in parallel behind the overlay, but `_renderContent()` skips AI generation when this flag is set. On overlay resolve (confirm or skip), the flag is cleared and AI rendering proceeds with the appropriate context.

---

## 2. Dashboard Habit Section Changes

### After Overlay Completion

- Habit section renders collapsed: "Checked in: X of Y habits"
- Tappable to expand (read-only view of completed habits, already locked)

### After Overlay Skip

- Habit section renders collapsed with prompt: "Check in your habits" (expandable)
- Expanding reveals toggle form (current behavior)
- On confirm from dashboard: collapses and locks as usual

### Key Change

The habit section is always collapsed by default on the dashboard. The overlay is the primary check-in experience. The dashboard section serves as a summary (post-check-in) or fallback (post-skip).

---

## 3. AI Insight Gating Logic

Three states based on data availability:

### State 1: Sleep Data Ready

- Generate insight immediately with available context
- Habits included if checked in via overlay, excluded if skipped
- Happy path: user completed overlay, sleep data synced during or before — insight appears on dashboard reveal

### State 2: Sleep Data Not Yet Synced (Daytime)

- Show skeleton/shimmer in AI insight area
- Background sync runs a single `SleepSync.syncNow()` attempt on dashboard load
- If sync returns new data, auto-generate insight and replace skeleton
- If sync returns nothing, shimmer remains until user pulls to refresh (no polling loop)
- No text message — shimmer signals that content is loading

### State 3: Sleep Data Not Yet Synced (Bedtime Window)

- Show message: "Waiting for your sleep data" with subtle sync indicator
- Bedtime window: user's average bedtime minus 1 hour through average wake time plus 2 hours
- Wake time derived from `bedtime_start + total_sleep_minutes` (no `wake_time` column exists; this is a sufficient approximation)
- Calculated from historical Oura sleep data (up to 30 days)
- Fallback if insufficient data (fewer than 7 nights): 10:00 PM to 9:00 AM
- Bedtime window evaluated once at render time (no live transitions or timers)
- Once sleep data arrives (next morning sync or pull-to-refresh), auto-generates and replaces the message

### Precedence: Bedtime Window vs Data Availability

| Sleep data synced? | In bedtime window? | Result |
|----|----|----|
| Yes | No | Generate insight (State 1) |
| Yes | Yes | Generate insight (State 1) — data availability always wins |
| No | No | Show shimmer (State 2) |
| No | Yes | Show "Waiting for sleep data" (State 3) |

The bedtime window only affects display when sleep data is unavailable. If last night's data is synced, the insight generates regardless of time of day.

### No AI Insight Shown When

- No active challenge
- No sleep data at all (new user before first Oura sync)

---

## 4. End-to-End Flows

### Morning Open (Typical)

1. User opens app — dashboard starts loading (profile, sleep, challenges, league)
2. Overlay check fires — active challenge + not checked in — overlay appears
3. User toggles habits, taps Confirm (~10-15 seconds)
4. Overlay animates away — dashboard revealed with sleep cards, league scoreboard
5. AI insight: sleep data arrived during overlay — insight generating or visible. If not — skeleton shimmer until sync completes.

### Evening/Night Open

1. Dashboard loads — overlay shown if not checked in (same flow)
2. After overlay — AI insight area shows "Waiting for your sleep data" (within bedtime window)
3. No insight generated until next morning's sleep data syncs

### Already Checked In Today

1. Dashboard loads normally, no overlay
2. Habit section collapsed with summary
3. AI insight renders from cache or generates fresh

### No Active Challenge

1. Dashboard loads normally, no overlay
2. No habit section, no AI insight

### Skip Flow

1. Overlay shown — user taps "Skip for now"
2. Dashboard revealed — habit section collapsed but expandable
3. AI insight generates without habit data (skeleton then insight)
4. If user later checks in from dashboard — AI insight does NOT re-generate (keeps current session's insight)

---

## 5. Implementation Scope

### New Components

- Habit check-in overlay (full-screen modal in `js/dashboard.js`)
- Bedtime window calculator (utility function using historical sleep data)
- "Waiting for sleep data" card variant in AI insight area

### Modified Components

- `Dashboard.render()` — trigger overlay check before revealing content
- `Dashboard._renderContent()` — collapse habit section by default
- AI insight rendering — add bedtime window check, shimmer vs waiting message logic

### New State Variables

| Variable | Scope | Purpose |
|----|----|----|
| `Dashboard._overlayPending` | In-memory | Suppresses AI rendering while overlay is visible |
| `Dashboard._overlaySkippedToday` | In-memory (session) | Prevents overlay re-showing after skip within same session |

### No Changes To

- `Challenges.saveHabitBatch()` — reuse existing save logic
- Server-side AI endpoints — no API changes needed
- Service worker — no caching changes
- Habit data model — same `habit_completions` table
- Database schema — wake time derived from existing `bedtime_start` + `total_sleep_minutes`
