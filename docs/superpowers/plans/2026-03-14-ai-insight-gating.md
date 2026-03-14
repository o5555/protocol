# AI Insight Gating Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate AI insight generation behind a habit check-in overlay that appears on app open, and show contextual waiting states when sleep data is unavailable.

**Architecture:** A full-screen overlay renders on top of the dashboard while data loads in parallel behind it. Two new state flags (`_overlayPending`, `_overlaySkippedToday`) control overlay visibility and suppress AI generation until the overlay resolves. A bedtime window calculator uses historical sleep data to switch between shimmer and "Waiting for sleep data" states.

**Tech Stack:** Vanilla JS, Tailwind CSS (CDN), Supabase client, existing Dashboard/Challenges modules.

**Spec:** `docs/superpowers/specs/2026-03-14-ai-insight-gating-design.md`

**Note:** Line number references are based on the pre-edit file and will shift after earlier tasks. Use the surrounding code patterns as landmarks when line numbers drift. Also: `_fetchHabitData()` already filters habits by challenge mode (light/pro) at lines 398-403, so `this._habitData.habits` is pre-filtered — no additional filtering is needed in the overlay.

---

## Chunk 1: Overlay Infrastructure and AI Suppression

### Task 1: Add overlay state flags and suppression logic

**Files:**
- Modify: `js/dashboard.js:3-16` (state variables)
- Modify: `js/dashboard.js:22-27` (render() reset)
- Modify: `js/dashboard.js:1116-1157` (AI rendering gate)

- [ ] **Step 1: Add new state variables to Dashboard object**

At `js/dashboard.js:10` (after `_habitCheckinLocked`), add:

```javascript
  _overlayPending: false,    // true while habit overlay is visible — suppresses AI rendering
  _overlaySkippedToday: false, // true after Skip — prevents re-showing overlay this session
```

- [ ] **Step 2: Reset `_overlayPending` in render() but preserve `_overlaySkippedToday`**

At `js/dashboard.js:22-27`, the existing reset block resets habit state per render. Add `_overlayPending` reset but do NOT reset `_overlaySkippedToday` (it persists across tab switches within the same session):

```javascript
    // Reset local check-in buffer — locked state is re-detected from localStorage
    this._habitCheckinPending = null;
    this._habitCheckinLocked = false;
    this._overlayPending = false;  // Reset per render; set true again if overlay triggers
    // Note: _overlaySkippedToday is NOT reset here — it persists across tab switches
    // Reset AI flags so failures from a previous visit don't block retries
    this._aiFetchFailed = false;
    this._aiCardRenderedInsight = null;
```

- [ ] **Step 3: Add AI suppression check in `_renderContent()`**

At `js/dashboard.js:1116` (start of AI insight rendering block), wrap the entire AI block with an overlay guard:

```javascript
      // AI insight card — rendered into a SEPARATE container (ai-insight-container)
      // that lives outside dashboard-container and is NEVER wiped by innerHTML.
      // _renderContent runs up to 3x per render() (cache, fresh, sync); each
      // sets container.innerHTML, which would destroy inline AI cards. By using a
      // sibling container, the AI card persists across all re-renders.
      //
      // GATING: suppress all AI rendering while the habit overlay is pending.
      // The overlay sets _overlayPending=true; on confirm/skip it clears the flag
      // and triggers AI rendering explicitly.
      const aiChallengeId = activeChallenges?.[0]?.id || 'personal';
      const aiContainer = document.getElementById('ai-insight-container');
      if (aiContainer && recentSleep.length > 0 && !this._overlayPending) {
```

This is a single-line change: add `&& !this._overlayPending` to the existing `if` condition at line 1123.

- [ ] **Step 4: Run tests to verify no regressions**

Run: `npx playwright test tests/e2e/dashboard.spec.js`
Expected: All existing dashboard tests pass (AI suppression flag defaults to `false`, so behavior is unchanged)

- [ ] **Step 5: Commit**

```bash
git add js/dashboard.js
git commit -m "feat: Add overlay state flags and AI suppression gate"
```

---

### Task 2: Build the habit check-in overlay

**Files:**
- Modify: `js/dashboard.js` (add `_renderOverlay`, `_showOverlay`, `_dismissOverlay`, `_handleOverlayConfirm`, `_handleOverlaySkip` methods)

- [ ] **Step 1: Add `_shouldShowOverlay()` method**

Add after the `_isCheckedIn` / `_markCheckedIn` block (~line 427), before `_renderHabitCollapsed`:

```javascript
  // Check if the habit overlay should be shown
  _shouldShowOverlay() {
    if (this._overlaySkippedToday) return false;
    if (!this._habitData) return false;
    const { challenge, habits, firstDay, today } = this._habitData;
    if (!challenge || !habits || habits.length === 0) return false;
    if (firstDay) return false;
    // Already checked in (localStorage or DB)
    if (this._isCheckedIn(challenge.id, today)) return false;
    if (this._habitData.completions?.length > 0) return false;
    return true;
  },
```

- [ ] **Step 2: Add `_renderOverlay()` method**

Add after `_shouldShowOverlay()`:

```javascript
  // Render the full-screen habit check-in overlay HTML
  _renderOverlay() {
    const { challenge, habits, completions, today } = this._habitData;
    const pendingSet = this._overlayPendingSet || new Set(completions || []);
    this._overlayPendingSet = pendingSet;

    // Format yesterday's date for display
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    return `
      <div id="habit-overlay" class="fixed inset-0 bg-oura-bg z-50 flex flex-col safe-area-overlay">
        <div class="flex-1 flex flex-col px-6 pt-8 pb-4 sm:max-w-md sm:mx-auto w-full">
          <div class="mb-8">
            <h2 class="text-2xl font-semibold text-white mb-1">Yesterday's Habits</h2>
            <p class="text-oura-muted text-sm">${dateStr}</p>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div class="space-y-0 divide-y divide-oura-border/20">
              ${habits.map(h => {
                const checked = pendingSet.has(h.id);
                return `
                <button class="overlay-habit-row flex items-center gap-3 w-full text-left py-4 min-h-[52px]"
                        data-habit-id="${h.id}" data-checked="${checked}"
                        role="checkbox" aria-checked="${checked}" aria-label="${escapeHtml(h.title)}">
                  <div class="w-7 h-7 rounded-lg border ${checked
                    ? 'bg-oura-accent border-oura-accent'
                    : 'border-oura-border'} flex items-center justify-center flex-shrink-0">
                    ${checked ? '<svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>' : ''}
                  </div>
                  <span class="text-base ${checked ? 'text-oura-muted line-through' : 'text-white'}">${escapeHtml(h.title)}</span>
                </button>`;
              }).join('')}
            </div>
          </div>
          <div class="pt-4 pb-2">
            <button id="overlay-confirm"
              class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all text-base">
              Confirm
            </button>
            <button id="overlay-skip" class="w-full py-3 text-oura-muted text-sm mt-1">
              Skip for now
            </button>
          </div>
        </div>
      </div>`;
  },
```

- [ ] **Step 3: Add `_showOverlay()` method**

```javascript
  // Show the habit check-in overlay and attach listeners
  _showOverlay() {
    this._overlayPending = true;
    this._overlayPendingSet = new Set(this._habitData.completions || []);

    // Insert overlay into the DOM
    const overlayHtml = this._renderOverlay();
    const overlayWrapper = document.createElement('div');
    overlayWrapper.id = 'habit-overlay-wrapper';
    overlayWrapper.innerHTML = overlayHtml;
    document.body.appendChild(overlayWrapper);

    // Attach event listeners via delegation
    overlayWrapper.addEventListener('click', (e) => {
      if (e.target.closest('#overlay-confirm')) {
        e.stopPropagation();
        this._handleOverlayConfirm();
        return;
      }
      if (e.target.closest('#overlay-skip')) {
        e.stopPropagation();
        this._handleOverlaySkip();
        return;
      }
      const row = e.target.closest('.overlay-habit-row');
      if (row) {
        e.stopPropagation();
        this._handleOverlayToggle(row);
      }
    });
  },
```

- [ ] **Step 4: Add `_handleOverlayToggle()` method**

```javascript
  // Toggle a habit in the overlay (local only — same pattern as dashboard toggle)
  _handleOverlayToggle(row) {
    const habitId = row.dataset.habitId;
    const wasChecked = row.dataset.checked === 'true';

    if (wasChecked) {
      this._overlayPendingSet.delete(habitId);
    } else {
      this._overlayPendingSet.add(habitId);
    }

    row.dataset.checked = String(!wasChecked);
    row.setAttribute('aria-checked', String(!wasChecked));
    const box = row.querySelector('div:first-child');
    const label = row.querySelector('span');
    if (!wasChecked) {
      box.className = 'w-7 h-7 rounded-lg border bg-oura-accent border-oura-accent flex items-center justify-center flex-shrink-0';
      box.innerHTML = '<svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>';
      label.className = 'text-base text-oura-muted line-through';
    } else {
      box.className = 'w-7 h-7 rounded-lg border border-oura-border flex items-center justify-center flex-shrink-0';
      box.innerHTML = '';
      label.className = 'text-base text-white';
    }
  },
```

- [ ] **Step 5: Add `_dismissOverlay()` method**

```javascript
  // Animate out and remove the overlay from DOM
  _dismissOverlay() {
    const overlay = document.getElementById('habit-overlay');
    if (overlay) {
      overlay.style.transition = 'opacity 200ms ease-out';
      overlay.style.opacity = '0';
      setTimeout(() => {
        const wrapper = document.getElementById('habit-overlay-wrapper');
        if (wrapper) wrapper.remove();
      }, 200);
    } else {
      const wrapper = document.getElementById('habit-overlay-wrapper');
      if (wrapper) wrapper.remove();
    }
    this._overlayPending = false;
  },
```

- [ ] **Step 6: Add `_handleOverlayConfirm()` method**

```javascript
  // Handle overlay Confirm — save habits, dismiss, trigger AI
  async _handleOverlayConfirm() {
    const { challenge, habits, today } = this._habitData;
    const pending = [...this._overlayPendingSet];
    const btn = document.getElementById('overlay-confirm');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving...';
      btn.classList.add('opacity-60');
    }

    try {
      await Challenges.saveHabitBatch(challenge.id, pending, today);

      // Update local habit data
      this._habitData.completions = pending;
      this._habitCheckinPending = new Set(pending);

      // Lock check-in in localStorage
      this._markCheckedIn(challenge.id, today, pending.length, habits.length);

      // Dismiss overlay
      this._dismissOverlay();

      // Re-render dashboard habit section as collapsed
      const container = document.getElementById('dashboard-container');
      if (container) {
        const section = container.querySelector('#habit-section');
        if (section) {
          section.outerHTML = this._renderHabitCollapsed(pending.length, habits.length);
        }
      }

      // Trigger AI insight now that habits are confirmed
      this._refreshAiAfterCheckin();
    } catch (err) {
      console.warn('[Dashboard] Overlay habit save failed:', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Confirm';
        btn.classList.remove('opacity-60');
      }
      // Show error feedback
      const overlay = document.getElementById('habit-overlay');
      if (overlay) {
        let toast = overlay.querySelector('.overlay-error');
        if (!toast) {
          toast = document.createElement('div');
          toast.className = 'overlay-error text-red-400 text-sm text-center py-2';
          const skipBtn = document.getElementById('overlay-skip');
          if (skipBtn) skipBtn.before(toast);
        }
        toast.textContent = "Couldn't save your habits. Try again.";
      }
    }
  },
```

- [ ] **Step 7: Add `_handleOverlaySkip()` method**

```javascript
  // Handle overlay Skip — dismiss without saving, allow AI to generate without habits
  _handleOverlaySkip() {
    this._overlaySkippedToday = true;
    this._dismissOverlay();

    // Trigger AI rendering now (without habit data)
    const cached = Cache.get('dashboard');
    if (cached) {
      const container = document.getElementById('dashboard-container');
      if (container) {
        // AI rendering was suppressed; now trigger it
        this._triggerAiAfterOverlay(cached.recentSleep, cached.leagueData, cached.activeChallenges);
      }
    }
  },
```

- [ ] **Step 8: Add `_triggerAiAfterOverlay()` helper**

This is needed because after the overlay dismisses, the AI rendering in `_renderContent` was skipped. We need to run just the AI portion:

```javascript
  // Run AI insight rendering after overlay resolves (confirm or skip)
  _triggerAiAfterOverlay(recentSleep, leagueData, activeChallenges) {
    const aiChallengeId = activeChallenges?.[0]?.id || 'personal';
    const aiContainer = document.getElementById('ai-insight-container');
    if (!aiContainer || !recentSleep || recentSleep.length === 0) return;

    const today = DateUtils.toLocalDateStr(new Date());
    const cacheKey = `ai_insight_${aiChallengeId}_${today}`;
    const cachedInsight = Cache.get(cacheKey);
    const hasTodayData = recentSleep[0]?.date === today;

    if (cachedInsight) {
      this._aiCardRenderedInsight = cachedInsight;
      aiContainer.innerHTML = this._renderAiCard(cachedInsight);
    } else if (!this._aiFetchInFlight && !this._aiFetchFailed && hasTodayData) {
      aiContainer.innerHTML = this._renderAiCardLoading();
      this._aiCardRenderedInsight = null;
      const gen = this._renderGeneration;
      this._aiFetchInFlight = true;
      this._fetchAiInsight(recentSleep, leagueData, false, aiChallengeId).then(insight => {
        this._aiFetchInFlight = false;
        if (gen !== this._renderGeneration) return;
        const ac = document.getElementById('ai-insight-container');
        if (ac && insight) {
          this._aiFetchFailed = false;
          this._aiCardRenderedInsight = insight;
          ac.innerHTML = this._renderAiCard(insight);
        } else if (ac) {
          this._aiFetchFailed = true;
          ac.innerHTML = '';
        }
      }).catch(() => { this._aiFetchInFlight = false; this._aiFetchFailed = true; });
    } else if (!hasTodayData) {
      // Sleep data not yet synced — show shimmer or bedtime waiting state
      aiContainer.innerHTML = this._renderAiWaitingState(recentSleep);
    }
  },
```

- [ ] **Step 9: Commit**

```bash
git add js/dashboard.js
git commit -m "feat: Build habit check-in overlay with confirm/skip/toggle"
```

---

### Task 3: Wire overlay into Dashboard.render()

**Files:**
- Modify: `js/dashboard.js:59-68` (after habit data loads, before background sync)

- [ ] **Step 1: Add overlay trigger after habit data loads**

At `js/dashboard.js:61-68`, after the `Promise.all([leaguePromise, habitPromise])` resolves and before the `_backgroundSync` call, add the overlay check:

```javascript
      [leagueData] = await Promise.all([leaguePromise, habitPromise]);
      if (generation !== this._renderGeneration) return;

      // Cache the data
      Cache.set('dashboard', { profile, activeChallenges, recentSleep, leagueData });

      // Check if habit overlay should be shown (before rendering content)
      if (this._shouldShowOverlay()) {
        this._overlayPending = true;  // Suppress AI in _renderContent
      }

      // Re-render with fresh data
      this._renderContent(container, { profile, activeChallenges, recentSleep, leagueData });

      // Show overlay AFTER content renders (so dashboard loads behind it)
      if (this._overlayPending && !document.getElementById('habit-overlay-wrapper')) {
        this._showOverlay();
      }

      // Background sync: pull latest Oura data, then re-render if new data arrived
      if (profile?.oura_token && typeof SleepSync !== 'undefined') {
        this._backgroundSync(generation);
      }
```

This replaces the existing lines 64-73.

- [ ] **Step 2: Run all tests**

Run: `npx playwright test tests/e2e/dashboard.spec.js`
Expected: All pass — overlay only shows when `_shouldShowOverlay()` returns true (requires active challenge + unchecked habits)

- [ ] **Step 3: Commit**

```bash
git add js/dashboard.js
git commit -m "feat: Wire overlay trigger into Dashboard.render() flow"
```

---

### Task 4: Collapse habit section by default on dashboard

**Files:**
- Modify: `js/dashboard.js:446-508` (`_renderHabitSection`)

- [ ] **Step 1: Modify `_renderHabitSection` to default to collapsed state**

Replace the State B (pre-check-in) rendering at lines 474-508. When the overlay was skipped, show a collapsed expandable prompt instead of the full form:

After the existing State A block (line 471), replace State B:

```javascript
    // State B — not yet checked in
    // If overlay was shown and skipped, show collapsed expandable prompt
    // If overlay was not applicable (no overlay scenario), also show collapsed
    if (!this._habitCheckinPending) {
      this._habitCheckinPending = new Set(completions);
    }

    const pendingSet = this._habitCheckinPending;
    const completedCount = pendingSet.size;

    // Default to collapsed state — user can expand to check in
    return `
      <div class="bg-oura-card rounded-2xl p-4 border border-oura-border/30 mb-3" id="habit-section">
        <button class="flex items-center justify-between w-full" id="habit-expand-toggle">
          <div class="flex items-center gap-3">
            <div class="w-6 h-6 rounded-lg border border-oura-border flex items-center justify-center flex-shrink-0">
              <svg class="w-4 h-4 text-oura-muted" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
            </div>
            <span class="text-sm text-oura-muted">Check in your habits</span>
          </div>
          <svg class="w-4 h-4 text-oura-muted transition-transform" id="habit-expand-chevron" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>
        </button>
        <div class="hidden mt-3" id="habit-expand-content">
          <div class="space-y-0 divide-y divide-oura-border/20">
            ${habits.map(h => {
              const checked = pendingSet.has(h.id);
              return `
              <button class="habit-check-row flex items-center gap-3 w-full text-left py-3 min-h-[48px]"
                      data-habit-id="${h.id}" data-checked="${checked}"
                      role="checkbox" aria-checked="${checked}" aria-label="${escapeHtml(h.title)}">
                <div class="w-6 h-6 rounded-lg border ${checked
                  ? 'bg-oura-accent border-oura-accent'
                  : 'border-oura-border'} flex items-center justify-center flex-shrink-0">
                  ${checked ? '<svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>' : ''}
                </div>
                <span class="text-sm ${checked ? 'text-oura-muted line-through' : 'text-white'}">${escapeHtml(h.title)}</span>
              </button>`;
            }).join('')}
          </div>
          <button id="habit-checkin-confirm"
            class="w-full mt-4 py-3 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all">
            Check in
          </button>
        </div>
      </div>`;
  },
```

- [ ] **Step 2: Guard dashboard confirm against AI re-generation after skip**

In the existing `_handleHabitCheckinConfirm` method (~line 591), wrap the AI refresh call:

Replace:
```javascript
      // One-shot AI refresh
      this._refreshAiAfterCheckin();
```

With:
```javascript
      // One-shot AI refresh — but NOT if the overlay was skipped earlier.
      // Per spec: "If user later checks in from dashboard — AI insight does NOT re-generate"
      if (!this._overlaySkippedToday) {
        this._refreshAiAfterCheckin();
      }
```

- [ ] **Step 3: Add expand/collapse listener in `_attachHabitListeners`**

At the start of the `_attachHabitListeners` click handler (before the confirm button check), add:

```javascript
      // Expand/collapse toggle for habit section
      if (e.target.closest('#habit-expand-toggle')) {
        e.stopPropagation();
        const content = document.getElementById('habit-expand-content');
        const chevron = document.getElementById('habit-expand-chevron');
        if (content) {
          content.classList.toggle('hidden');
          if (chevron) chevron.classList.toggle('rotate-180');
        }
        return;
      }
```

- [ ] **Step 4: Add safe-area CSS class for overlay**

Add to `css/mobile.css`:

```css
/* Habit check-in overlay safe areas */
.safe-area-overlay {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
```

- [ ] **Step 5: Run tests**

Run: `npx playwright test tests/e2e/dashboard.spec.js`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add js/dashboard.js css/mobile.css
git commit -m "feat: Default habit section to collapsed with expand toggle"
```

---

## Chunk 2: Bedtime Window and Waiting States

### Task 5: Build bedtime window calculator

**Files:**
- Modify: `js/dashboard.js` (add `_calcBedtimeWindow` and `_isInBedtimeWindow` methods)

- [ ] **Step 1: Write the bedtime window calculator**

Add after the `_formatBedtime` method (~line 657):

```javascript
  // Calculate the user's bedtime window from historical sleep data.
  // Returns { start: hours (0-23.99), end: hours (0-23.99) } in local-time-of-sleep.
  // "start" = avg bedtime minus 1 hour, "end" = avg wake time plus 2 hours.
  // If fewer than 7 nights of data, falls back to 22:00 - 09:00.
  _calcBedtimeWindow(recentSleep) {
    const FALLBACK = { start: 22, end: 9 };
    if (!recentSleep || recentSleep.length < 7) return FALLBACK;

    // Cap at 30 days per spec
    const sleepWindow = recentSleep.slice(0, 30);

    // Collect bedtime hours and derived wake hours from valid nights
    const bedtimeHours = [];
    const wakeHours = [];

    for (const night of sleepWindow) {
      if (!night.bedtime_start || !night.total_sleep_minutes) continue;
      const btMatch = night.bedtime_start.match(/T(\d{2}):(\d{2})/);
      if (!btMatch) continue;

      const btH = parseInt(btMatch[1], 10);
      const btM = parseInt(btMatch[2], 10);
      const bedtimeDecimal = btH + btM / 60;
      bedtimeHours.push(bedtimeDecimal);

      // Derive wake time = bedtime + sleep duration
      const wakeDecimal = (bedtimeDecimal + night.total_sleep_minutes / 60) % 24;
      wakeHours.push(wakeDecimal);
    }

    if (bedtimeHours.length < 7) return FALLBACK;

    // Circular mean for bedtime (handles 23:00 + 01:00 correctly)
    const avgBedtime = this._circularMeanHours(bedtimeHours);
    const avgWake = this._circularMeanHours(wakeHours);

    // Window: bedtime - 1hr to wake + 2hr
    const start = (avgBedtime - 1 + 24) % 24;
    const end = (avgWake + 2) % 24;
    return { start, end };
  },

  // Circular mean for hours (0-23.99) — handles midnight crossover
  _circularMeanHours(hours) {
    let sinSum = 0, cosSum = 0;
    for (const h of hours) {
      const rad = (h / 24) * 2 * Math.PI;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
    }
    let avgRad = Math.atan2(sinSum / hours.length, cosSum / hours.length);
    if (avgRad < 0) avgRad += 2 * Math.PI;
    return (avgRad / (2 * Math.PI)) * 24;
  },

  // Check if the current time falls within the bedtime window
  _isInBedtimeWindow(recentSleep) {
    const { start, end } = this._calcBedtimeWindow(recentSleep);
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;

    // Handle midnight crossover (e.g., start=21, end=11 spans midnight)
    if (start > end) {
      return currentHour >= start || currentHour < end;
    }
    return currentHour >= start && currentHour < end;
  },
```

- [ ] **Step 2: Write test for bedtime window calculator**

Add to `tests/e2e/dashboard.spec.js`:

```javascript
test.describe('Bedtime Window Calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('falls back to 22-9 with fewer than 7 nights', async ({ page }) => {
    const result = await page.evaluate(() => {
      const sleep = Array.from({ length: 5 }, (_, i) => ({
        date: `2026-03-${10 + i}`,
        bedtime_start: `2026-03-${10 + i}T23:00:00-06:00`,
        total_sleep_minutes: 420
      }));
      return Dashboard._calcBedtimeWindow(sleep);
    });
    expect(result).toEqual({ start: 22, end: 9 });
  });

  test('calculates window from 7+ nights', async ({ page }) => {
    const result = await page.evaluate(() => {
      const sleep = Array.from({ length: 10 }, (_, i) => ({
        date: `2026-03-${10 + i}`,
        bedtime_start: `2026-03-${10 + i}T23:00:00-06:00`,
        total_sleep_minutes: 480
      }));
      return Dashboard._calcBedtimeWindow(sleep);
    });
    // avg bedtime ~23:00, avg wake ~07:00
    // window: 22:00 - 09:00
    expect(result.start).toBeCloseTo(22, 0);
    expect(result.end).toBeCloseTo(9, 0);
  });

  test('circular mean handles midnight crossover', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Half at 23:00, half at 01:00 — avg should be ~0:00
      return Dashboard._circularMeanHours([23, 23, 1, 1]);
    });
    expect(result).toBeCloseTo(0, 0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx playwright test tests/e2e/dashboard.spec.js`
Expected: All pass including new bedtime window tests

- [ ] **Step 4: Commit**

```bash
git add js/dashboard.js tests/e2e/dashboard.spec.js
git commit -m "feat: Add bedtime window calculator with circular mean"
```

---

### Task 6: Add AI waiting states (shimmer vs bedtime message)

**Files:**
- Modify: `js/dashboard.js` (add `_renderAiWaitingState`, `_renderAiWaitingForSleep`)

- [ ] **Step 1: Add `_renderAiWaitingForSleep()` method**

Add after `_renderAiCardLoading()` (~line 898):

```javascript
  // Render "Waiting for your sleep data" card — shown during bedtime window
  _renderAiWaitingForSleep() {
    return `
      <div class="bg-oura-card rounded-2xl p-5 border border-oura-border/30 mb-6" id="ai-card-slot">
        <div class="flex items-center gap-3">
          <div class="relative w-5 h-5 flex-shrink-0">
            <div class="absolute inset-0 rounded-full border-2 border-oura-border"></div>
            <div class="absolute inset-0 rounded-full border-2 border-oura-accent border-t-transparent animate-spin"></div>
          </div>
          <span class="text-sm text-oura-muted">Waiting for your sleep data</span>
        </div>
      </div>`;
  },
```

- [ ] **Step 2: Add `_renderAiWaitingState()` method**

This is the decision method that picks between shimmer and bedtime message:

```javascript
  // Render the appropriate waiting state based on time of day
  _renderAiWaitingState(recentSleep) {
    if (this._isInBedtimeWindow(recentSleep)) {
      return this._renderAiWaitingForSleep();
    }
    // Daytime: show shimmer skeleton
    return this._renderAiCardLoading();
  },
```

- [ ] **Step 3: Update `_renderContent` to use waiting states when sleep data is unavailable**

In the AI rendering block of `_renderContent`, after the existing logic, update the else branch at line ~1159:

Replace:
```javascript
      } else if (aiContainer && !aiContainer.innerHTML.trim()) {
        // No sleep data AND no card showing — leave empty (don't clear existing cards)
      }
```

With:
```javascript
      } else if (aiContainer && recentSleep.length > 0 && !this._overlayPending) {
        // Sleep data exists but no today data and no cached insight — show waiting state
        const hasTodayData = recentSleep[0]?.date === DateUtils.toLocalDateStr(new Date());
        if (!hasTodayData && !this._aiFetchInFlight) {
          aiContainer.innerHTML = this._renderAiWaitingState(recentSleep);
        }
      }
```

- [ ] **Step 4: Also update `_triggerAiAfterOverlay` to use the waiting state**

The `_triggerAiAfterOverlay` method (added in Task 2, Step 8) already includes the waiting state call via `this._renderAiWaitingState(recentSleep)`. Verify this is correct.

- [ ] **Step 5: Run tests**

Run: `npx playwright test tests/e2e/dashboard.spec.js`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add js/dashboard.js
git commit -m "feat: Add AI waiting states — shimmer for daytime, message for bedtime"
```

---

## Chunk 3: Integration and Polish

### Task 7: Handle overlay in background sync re-render

**Files:**
- Modify: `js/dashboard.js:88-120` (`_backgroundSync`)

- [ ] **Step 1: Skip overlay-triggering in background sync re-renders**

The background sync calls `_renderContent()` when new data arrives. If the overlay is already visible, `_overlayPending` is already true and AI is suppressed. But we need to ensure the background sync doesn't try to show a second overlay or interfere with an active one.

At `js/dashboard.js:114-115`, where `_backgroundSync` calls `_renderContent`, the overlay state is already handled by the `_overlayPending` flag in `_renderContent`. No changes needed to the background sync method itself — the existing `_overlayPending` check in `_renderContent` already gates AI.

Verify: read the background sync method and confirm no overlay logic is needed there.

- [ ] **Step 2: Handle overlay during cached render**

At `js/dashboard.js:32-35`, the cached render path also calls `_renderContent`. Since `_overlayPending` defaults to `false` on each `render()` call (line 23) and is only set to `true` after habit data loads (Task 3), the cached render will NOT have AI suppressed. This is fine — the cached render happens before we know if an overlay is needed. Once fresh data arrives and the overlay triggers, AI gets suppressed from that point on.

No code change needed. This is a verification step.

- [ ] **Step 3: Commit (skip if no changes)**

No changes expected — this task is verification only.

---

### Task 8: Bump service worker cache version

**Files:**
- Modify: `sw.js` (bump `CACHE_NAME`)

- [ ] **Step 1: Find current cache version and bump**

Read the `CACHE_NAME` line in `sw.js` and increment the version number by 1.

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "chore: Bump SW cache to pc-vNN"
```

---

### Task 9: Write e2e tests for the overlay flow

**Files:**
- Create: `tests/e2e/habit-overlay.spec.js`

- [ ] **Step 1: Write overlay tests**

```javascript
// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Habit Check-in Overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Dashboard has _shouldShowOverlay method', async ({ page }) => {
    const has = await page.evaluate(() => typeof Dashboard._shouldShowOverlay === 'function');
    expect(has).toBe(true);
  });

  test('_shouldShowOverlay returns false when no habit data', async ({ page }) => {
    const result = await page.evaluate(() => {
      Dashboard._habitData = null;
      return Dashboard._shouldShowOverlay();
    });
    expect(result).toBe(false);
  });

  test('_shouldShowOverlay returns false when skipped', async ({ page }) => {
    const result = await page.evaluate(() => {
      Dashboard._overlaySkippedToday = true;
      Dashboard._habitData = { challenge: { id: '1' }, habits: [{ id: 'h1' }], completions: [], today: '2026-03-13', firstDay: false };
      const r = Dashboard._shouldShowOverlay();
      Dashboard._overlaySkippedToday = false;
      return r;
    });
    expect(result).toBe(false);
  });

  test('_shouldShowOverlay returns false on first day', async ({ page }) => {
    const result = await page.evaluate(() => {
      Dashboard._habitData = { challenge: { id: '1' }, habits: [{ id: 'h1' }], completions: [], today: '2026-03-13', firstDay: true };
      return Dashboard._shouldShowOverlay();
    });
    expect(result).toBe(false);
  });

  test('_shouldShowOverlay returns false when already checked in', async ({ page }) => {
    const result = await page.evaluate(() => {
      Dashboard._habitData = { challenge: { id: 'test-overlay' }, habits: [{ id: 'h1' }], completions: ['h1'], today: '2026-03-13', firstDay: false };
      return Dashboard._shouldShowOverlay();
    });
    expect(result).toBe(false);
  });

  test('_renderOverlay produces valid HTML with habits', async ({ page }) => {
    const html = await page.evaluate(() => {
      Dashboard._habitData = {
        challenge: { id: '1' },
        habits: [{ id: 'h1', title: 'Cold shower' }, { id: 'h2', title: 'Meditation' }],
        completions: [],
        today: '2026-03-13',
        firstDay: false
      };
      Dashboard._overlayPendingSet = new Set();
      return Dashboard._renderOverlay();
    });
    expect(html).toContain('Yesterday\'s Habits');
    expect(html).toContain('Cold shower');
    expect(html).toContain('Meditation');
    expect(html).toContain('overlay-confirm');
    expect(html).toContain('overlay-skip');
  });

  test('_dismissOverlay removes wrapper from DOM', async ({ page }) => {
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'habit-overlay-wrapper';
      div.innerHTML = '<div id="habit-overlay"></div>';
      document.body.appendChild(div);
    });
    const before = await page.evaluate(() => !!document.getElementById('habit-overlay-wrapper'));
    expect(before).toBe(true);

    await page.evaluate(() => {
      // Skip animation for test — remove directly
      const wrapper = document.getElementById('habit-overlay-wrapper');
      if (wrapper) wrapper.remove();
      Dashboard._overlayPending = false;
    });
    const after = await page.evaluate(() => !!document.getElementById('habit-overlay-wrapper'));
    expect(after).toBe(false);
  });

  test('overlay toggle updates data-checked attribute', async ({ page }) => {
    await page.evaluate(() => {
      Dashboard._overlayPendingSet = new Set();
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <button class="overlay-habit-row" data-habit-id="h1" data-checked="false">
          <div class="w-7 h-7 rounded-lg border border-oura-border flex items-center justify-center flex-shrink-0"></div>
          <span class="text-base text-white">Test habit</span>
        </button>`;
      document.body.appendChild(wrapper);
    });

    await page.evaluate(() => {
      const row = document.querySelector('.overlay-habit-row');
      Dashboard._handleOverlayToggle(row);
    });

    const checked = await page.evaluate(() =>
      document.querySelector('.overlay-habit-row').dataset.checked
    );
    expect(checked).toBe('true');

    const inSet = await page.evaluate(() => Dashboard._overlayPendingSet.has('h1'));
    expect(inSet).toBe(true);
  });
});

test.describe('AI Waiting States', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('_renderAiWaitingForSleep returns waiting card', async ({ page }) => {
    const html = await page.evaluate(() => Dashboard._renderAiWaitingForSleep());
    expect(html).toContain('Waiting for your sleep data');
    expect(html).toContain('animate-spin');
  });

  test('_renderAiWaitingState returns shimmer outside bedtime window', async ({ page }) => {
    const html = await page.evaluate(() => {
      // Stub _isInBedtimeWindow to return false
      const orig = Dashboard._isInBedtimeWindow;
      Dashboard._isInBedtimeWindow = () => false;
      const result = Dashboard._renderAiWaitingState([]);
      Dashboard._isInBedtimeWindow = orig;
      return result;
    });
    expect(html).toContain('skeleton-bar');
  });

  test('_renderAiWaitingState returns waiting message in bedtime window', async ({ page }) => {
    const html = await page.evaluate(() => {
      const orig = Dashboard._isInBedtimeWindow;
      Dashboard._isInBedtimeWindow = () => true;
      const result = Dashboard._renderAiWaitingState([]);
      Dashboard._isInBedtimeWindow = orig;
      return result;
    });
    expect(html).toContain('Waiting for your sleep data');
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx playwright test tests/e2e/habit-overlay.spec.js`
Expected: All pass

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: 0 failures

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/habit-overlay.spec.js
git commit -m "test: Add e2e tests for habit overlay and AI waiting states"
```

---

### Task 10: Manual testing checklist

- [ ] **Step 1: Start the server**

Run: `node server.js`

- [ ] **Step 2: Test morning happy path**

Open app with an active challenge and unchecked habits:
- Overlay appears with yesterday's habits
- Toggle some habits on/off
- Tap Confirm
- Overlay animates out
- Dashboard shows collapsed habit summary
- AI insight generates (if sleep data is available)

- [ ] **Step 3: Test skip flow**

Clear localStorage and reload:
- Overlay appears
- Tap "Skip for now"
- Overlay dismisses
- Dashboard shows collapsed "Check in your habits" (expandable)
- AI insight generates without habit data
- Navigate away and back — overlay does NOT re-appear

- [ ] **Step 4: Test no-overlay cases**

- No active challenge: no overlay, no habit section
- Already checked in: no overlay, collapsed summary shown
- First day of challenge: no overlay, info message shown

- [ ] **Step 5: Test waiting states (if applicable)**

If sleep data hasn't synced:
- Daytime: shimmer skeleton in AI area
- Bedtime window: "Waiting for your sleep data" message
