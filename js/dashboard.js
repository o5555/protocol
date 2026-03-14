// Performance Dashboard Module

const Dashboard = {
  // Chart instances for cleanup (prevent memory leaks)
  charts: {},

  // Render generation counter to prevent stale async callbacks from overwriting fresher renders
  _renderGeneration: 0,

  // Habit + AI state
  _habitData: null,
  _habitCheckinPending: null,  // Set<habitId> local buffer before confirm
  _habitCheckinLocked: false,  // true after confirm (prevents re-toggle)
  _overlayPending: false,    // true while habit overlay is visible — suppresses AI rendering
  _overlaySkippedToday: false, // true after Skip — prevents re-showing overlay this session
  _aiFetchInFlight: false,
  _aiFetchFailed: false,  // circuit breaker: skip skeleton after a failed fetch this session

  // Main render entry point
  async render() {
    const container = document.getElementById('dashboard-container');
    if (!container) return;

    // Reset local check-in buffer — locked state is re-detected from localStorage
    this._habitCheckinPending = null;
    this._habitCheckinLocked = false;
    this._overlayPending = false;  // Reset per render; set true again if overlay triggers
    // Note: _overlaySkippedToday is NOT reset here — it persists across tab switches
    // Reset AI flags so failures from a previous visit don't block retries
    this._aiFetchFailed = false;
    this._aiCardRenderedInsight = null;  // track rendered insight to skip redundant DOM writes

    const generation = ++this._renderGeneration;

    // Try to render instantly from cache (but always refresh in background)
    const cachedData = Cache.get('dashboard');
    if (cachedData) {
      this._renderContent(container, cachedData);
    } else {
      // Show minimal loading state to prevent flash of empty/wrong content
      container.innerHTML = '<div class="py-10 text-center text-oura-muted text-sm">Loading...</div>';
    }

    // Fetch fresh data (in background if we have cache)
    try {
      const [profile, activeChallenges, recentSleep] = await Promise.all([
        Auth.getProfile(),
        Challenges.getActiveChallenges().catch(() => []),
        this.getRecentSleepData().catch(() => [])
      ]);

      // Only update DOM if this is still the most recent render call
      if (generation !== this._renderGeneration) return;

      // Fetch league data + habit data in parallel (both depend on activeChallenges but not each other)
      let leagueData = null;
      const leaguePromise = activeChallenges.length > 0
        ? Comparison.getChallengeSleepData(activeChallenges[0].id)
            .then(async result => {
              const currentUser = await SupabaseClient.getCurrentUser();
              return this._buildLeagueData(result, currentUser?.id);
            })
            .catch(e => { console.warn('[Dashboard] League data fetch failed:', e); return null; })
        : Promise.resolve(null);

      const habitPromise = this._fetchHabitData(activeChallenges, generation);

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
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      if (generation !== this._renderGeneration) return;
      if (!cachedData) {
        container.innerHTML = `
          <div class="bg-red-900/20 border border-red-500 rounded-2xl p-4">
            <p class="text-red-400">Failed to load dashboard. Please try again.</p>
          </div>
        `;
      }
    }
  },

  // Sync Oura data in background, re-render dashboard if new data was written
  async _backgroundSync(generation) {
    try {
      const result = await SleepSync.syncNow({ silent: true, skipRefresh: true });
      if (generation !== this._renderGeneration) return;
      if (result?.success && result.count > 0) {
        // New data arrived — re-fetch and re-render
        const [profile, activeChallenges, recentSleep] = await Promise.all([
          Auth.getProfile(),
          Challenges.getActiveChallenges().catch(() => []),
          this.getRecentSleepData().catch(() => [])
        ]);
        if (generation !== this._renderGeneration) return;
        let leagueData = null;
        if (activeChallenges.length > 0) {
          try {
            const compCacheKey = 'comparison_' + activeChallenges[0].id;
            if (typeof Cache !== 'undefined') Cache.clear(compCacheKey);
            const r2 = await Comparison.getChallengeSleepData(activeChallenges[0].id);
            if (generation !== this._renderGeneration) return;
            const currentUser = await SupabaseClient.getCurrentUser();
            leagueData = this._buildLeagueData(r2, currentUser?.id);
          } catch (e) { /* ignore */ }
        }
        await this._fetchHabitData(activeChallenges, generation);
        if (generation !== this._renderGeneration) return;
        Cache.set('dashboard', { profile, activeChallenges, recentSleep, leagueData });
        const container = document.getElementById('dashboard-container');
        if (container) this._renderContent(container, { profile, activeChallenges, recentSleep, leagueData });
      }
    } catch (e) {
      console.warn('[Dashboard] Background sync failed:', e);
    }
  },

  // League metric definitions
  _leagueMetrics: [
    { key: 'score', label: 'Sleep Score', unit: 'pts', lowerIsBetter: false },
    { key: 'hr',    label: 'Avg Heart Rate', unit: 'bpm', lowerIsBetter: true },
    { key: 'low',   label: 'Lowest Heart Rate', unit: 'bpm', lowerIsBetter: true },
    { key: 'deep',  label: 'Deep Sleep', unit: 'min', lowerIsBetter: false },
    { key: 'preSleep', label: 'HR Before Sleep', unit: 'bpm', lowerIsBetter: true }
  ],
  _leagueIndex: 0,

  // Build league data from challenge comparison result
  _buildLeagueData(result, currentUserId) {
    const { challenge, sleepData } = result;
    if (!sleepData || sleepData.length === 0) return null;

    const participants = sleepData.map(p => {
      const cd = p.challengeData || [];
      // Use participant's most recent night with a sleep score
      // (skip entries from incomplete syncs where score is still null)
      let latest = {};
      for (let i = cd.length - 1; i >= 0; i--) {
        if (cd[i].sleep_score != null) { latest = cd[i]; break; }
      }
      // Compute actual challenge average across all nights (for AI context)
      const challengeAvgs = Comparison.calcAverages(cd);
      return {
        name: p.user.display_name || p.user.email.split('@')[0],
        isMe: p.user.id === currentUserId,
        score: latest.sleep_score ?? null,
        challengeAvg: challengeAvgs.score,
        hr: latest.avg_hr ?? null,
        low: latest.pre_sleep_hr ?? null,
        deep: latest.deep_sleep_minutes ?? null,
        preSleep: latest.hr_before_sleep ?? null
      };
    });

    return {
      challengeId: challenge.id,
      challengeName: challenge.name,
      dayNumber: Challenges.getDayNumber(challenge.start_date),
      participants
    };
  },

  // Render one slide of the league scoreboard for a given metric (no dots — rendered separately)
  _renderLeaguePage(leagueData, metricIndex) {
    const m = this._leagueMetrics[metricIndex];
    const sorted = [...leagueData.participants].sort((a, b) => {
      const av = a[m.key], bv = b[m.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return m.lowerIsBetter ? av - bv : bv - av;
    });

    return `
      <div class="text-center mb-5">
        <div class="text-sm font-bold text-oura-muted uppercase tracking-wider">${m.label}</div>
      </div>
      <div class="space-y-2">
        ${sorted.map((p, i) => {
          const rank = i + 1;
          const name = p.isMe ? 'You' : escapeHtml(p.name.split(' ')[0]);
          const val = p[m.key];
          const isFirst = i === 0 && val != null;
          const rowBg = p.isMe ? 'bg-oura-accent/5 border border-oura-accent/20' : 'bg-oura-subtle';
          const nameColor = p.isMe ? 'text-oura-accent' : 'text-white';
          const valColor = isFirst ? 'text-oura-accent' : 'text-white';
          return `
          <div class="flex items-center ${rowBg} rounded-xl px-4 py-3.5">
            <span class="text-sm font-bold text-oura-muted w-6">${rank}</span>
            <span class="flex-1 text-base font-semibold ${nameColor}">${name}</span>
            <span class="text-2xl font-bold ${valColor}">${val != null ? Math.round(val) : '--'}</span>
            <span class="text-xs text-oura-muted ml-1.5 w-8">${m.unit}</span>
          </div>`;
        }).join('')}
      </div>`;
  },

  // Render pagination dots with chevron affordances
  _renderLeagueDots(activeIndex) {
    const chevL = '<svg class="w-3.5 h-3.5 text-oura-border flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5"/></svg>';
    const chevR = '<svg class="w-3.5 h-3.5 text-oura-border flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>';
    const dots = this._leagueMetrics.map((_, i) => {
      const active = i === activeIndex;
      const cls = active
        ? 'w-6 h-2.5 rounded-full bg-oura-accent'
        : 'w-2.5 h-2.5 rounded-full bg-oura-border';
      return `<button class="${cls} transition-all" data-dot="${i}" onclick="event.stopPropagation(); Dashboard._switchLeagueMetric(${i})"></button>`;
    }).join('');
    return chevL + dots + chevR;
  },

  // Animate to a specific league metric page (called by swipe, dot tap, or programmatically)
  _switchLeagueMetric(index) {
    if (!this._leagueData) return;
    this._leagueIndex = index;
    const track = document.getElementById('league-track');
    const area = document.getElementById('league-swipe-area');
    if (!track || !area) return;
    const slide = track.querySelector('.league-slide');
    const slideW = slide ? slide.offsetWidth : area.clientWidth;
    track.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
    track.style.transform = `translateX(${-index * slideW}px)`;
    // Update dots
    const dotsEl = document.getElementById('league-dots');
    if (dotsEl) dotsEl.innerHTML = this._renderLeagueDots(index);
  },

  // Attach carousel drag + tap handlers to the league container
  _attachLeagueSwipe() {
    const area = document.getElementById('league-swipe-area');
    const track = document.getElementById('league-track');
    if (!area || !track) return;

    const total = this._leagueMetrics.length;
    let startX = 0, startY = 0, isDragging = false, startTime = 0;
    let directionLocked = false, isHorizontal = false;
    this._swipeOccurred = false;

    const getSlideWidth = () => {
      const slide = track.querySelector('.league-slide');
      return slide ? slide.offsetWidth : area.clientWidth;
    };

    // Set initial position (handles re-render when _leagueIndex > 0)
    track.style.transform = `translateX(${-this._leagueIndex * getSlideWidth()}px)`;

    area.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      isDragging = true;
      directionLocked = false;
      isHorizontal = false;
      this._swipeOccurred = false;
      track.style.transition = 'none';
    }, { passive: true });

    area.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      // Lock direction after sufficient movement
      if (!directionLocked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        directionLocked = true;
        isHorizontal = Math.abs(dx) >= Math.abs(dy);
      }
      if (!directionLocked || !isHorizontal) return;

      if (Math.abs(dx) > 15) this._swipeOccurred = true;

      const slideW = getSlideWidth();
      const baseOffset = -this._leagueIndex * slideW;
      let offset = baseOffset + dx;

      // Rubber-band damping (0.3x) at first/last edges
      if (this._leagueIndex === 0 && dx > 0) {
        offset = baseOffset + dx * 0.3;
      } else if (this._leagueIndex === total - 1 && dx < 0) {
        offset = baseOffset + dx * 0.3;
      }

      track.style.transform = `translateX(${offset}px)`;
    }, { passive: true });

    area.addEventListener('touchend', (e) => {
      if (!isDragging) return;
      isDragging = false;

      // If vertical or no direction locked, snap back
      if (!isHorizontal) {
        this._switchLeagueMetric(this._leagueIndex);
        return;
      }

      const dx = e.changedTouches[0].clientX - startX;
      const slideW = getSlideWidth();
      const threshold = slideW * 0.2;
      let target = this._leagueIndex;

      if (Math.abs(dx) > threshold) {
        if (dx < 0 && target < total - 1) target++;
        else if (dx > 0 && target > 0) target--;
      }

      this._switchLeagueMetric(target);
    }, { passive: true });

    // Programmatic click handler with swipe guard
    area.addEventListener('click', (e) => {
      // Don't navigate if a swipe just occurred
      if (this._swipeOccurred) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Don't navigate if a dot was tapped (dots have their own handler)
      if (e.target.closest('[data-dot]')) return;
      const challengeId = area.dataset.challengeId;
      if (challengeId) App.navigateTo('challenge-detail', challengeId);
    });

    // One-time peek animation — hints that the card is swipeable
    if (!localStorage.getItem('league_peek_shown')) {
      localStorage.setItem('league_peek_shown', '1');
      const slideW = getSlideWidth();
      const baseX = -this._leagueIndex * slideW;
      setTimeout(() => {
        track.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
        track.style.transform = `translateX(${baseX - 30}px)`;
        setTimeout(() => {
          track.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
          track.style.transform = `translateX(${baseX}px)`;
        }, 300);
      }, 600);
    }
  },

  // ── Habit Check-in ──

  // Fetch habits + completions for the active challenge
  async _fetchHabitData(activeChallenges, generation) {
    if (!activeChallenges || activeChallenges.length === 0) {
      this._habitData = null;
      return;
    }

    const challenge = activeChallenges[0];
    // Skip if challenge hasn't started yet
    if (Challenges.getDayNumber(challenge.start_date) === 0) return;

    try {
      const client = SupabaseClient.client;
      const user = await SupabaseClient.getCurrentUser();
      if (!client || !user) return;
      if (generation !== this._renderGeneration) return;

      // Habits reflect last night — users check in the morning after
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const habitDate = DateUtils.toLocalDateStr(yesterday);

      // Check if yesterday falls within the challenge period
      const challengeStart = Challenges.parseLocalDate(challenge.start_date);
      challengeStart.setHours(0, 0, 0, 0);
      yesterday.setHours(0, 0, 0, 0);
      if (yesterday < challengeStart) {
        // First day — no "last night" to check in yet
        const habitsResult = await client.from('protocol_habits')
          .select('id, title, sort_order')
          .eq('protocol_id', challenge.protocol.id)
          .order('sort_order');
        if (generation !== this._renderGeneration) return;
        let habits = habitsResult.data || [];
        if (challenge.mode === 'light') {
          const protocol = { ...challenge.protocol, habits };
          habits = Protocols.getHabitsForMode(protocol, 'light');
        }
        this._habitData = { challenge, habits, completions: [], today: habitDate, firstDay: true };
        return;
      }

      // Fetch protocol habits and last night's completions in parallel
      const [habitsResult, completions] = await Promise.all([
        client.from('protocol_habits')
          .select('id, title, sort_order')
          .eq('protocol_id', challenge.protocol.id)
          .order('sort_order'),
        Challenges.getHabitCompletions(challenge.id, user.id, habitDate)
      ]);

      if (generation !== this._renderGeneration) return;

      let habits = habitsResult.data || [];
      // Filter by mode (light vs pro)
      if (challenge.mode === 'light') {
        const protocol = { ...challenge.protocol, habits };
        habits = Protocols.getHabitsForMode(protocol, 'light');
      }

      this._habitData = { challenge, habits, completions, today: habitDate };
    } catch (e) {
      console.warn('[Dashboard] Habit data fetch failed:', e);
    }
  },

  // ── Habit check-in state helpers ──

  _getCheckinKey(challengeId, date) {
    return `habit_checkin_${challengeId}_${date}`;
  },

  _isCheckedIn(challengeId, date) {
    return !!Cache.get(this._getCheckinKey(challengeId, date));
  },

  _getCheckinSummary(challengeId, date) {
    return Cache.get(this._getCheckinKey(challengeId, date));
  },

  _markCheckedIn(challengeId, date, count, total) {
    Cache.set(this._getCheckinKey(challengeId, date), { checkedIn: true, count, total });
  },

  // ── Habit overlay methods ──

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

  // Render the full-screen habit check-in overlay HTML
  // Note: habits in _habitData are already filtered by challenge mode (light/pro) via _fetchHabitData
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
      // Uses existing _refreshAiAfterCheckin which does forceRefresh=true
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

  // Handle overlay Skip — dismiss without saving, allow AI to generate without habits
  _handleOverlaySkip() {
    this._overlaySkippedToday = true;
    this._dismissOverlay();

    // Trigger AI rendering now (without habit data)
    const cached = Cache.get('dashboard');
    if (cached) {
      // AI rendering was suppressed; now trigger it
      this._triggerAiAfterOverlay(cached.recentSleep, cached.leagueData, cached.activeChallenges);
    }
  },

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

  // Collapsed summary line after check-in
  _renderHabitCollapsed(count, total) {
    return `
      <div class="bg-oura-card rounded-2xl p-4 border border-oura-border/30 mb-3" id="habit-section">
        <div class="flex items-center gap-3">
          <div class="w-6 h-6 rounded-lg bg-oura-accent flex items-center justify-center flex-shrink-0">
            <svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
          </div>
          <span class="text-sm text-oura-muted">Checked in: ${count} of ${total}</span>
        </div>
      </div>`;
  },

  // Render the habit check-in section — three states:
  // A) Already checked in (collapsed summary)
  // B) Pre-check-in (toggles + confirm button)
  // C) First day (informational message)
  _renderHabitSection() {
    if (!this._habitData) return '';
    const { challenge, habits, completions, firstDay, today } = this._habitData;
    if (!habits || habits.length === 0) return '';

    // State C — first day of challenge
    if (firstDay) {
      return `
        <div class="bg-oura-card rounded-2xl p-4 border border-oura-border/30 mb-3">
          <h3 class="text-sm font-bold text-oura-muted uppercase tracking-wider mb-2">Last Night's Habits</h3>
          <p class="text-sm text-oura-muted">Check in tomorrow morning to log last night's habits.</p>
        </div>`;
    }

    // State A — already checked in today (localStorage lock OR DB completions)
    const lockedIn = this._isCheckedIn(challenge.id, today);
    const dbConfirmed = completions.length > 0;
    if (lockedIn || dbConfirmed) {
      const summary = this._getCheckinSummary(challenge.id, today);
      const count = summary?.count ?? completions.length;
      const total = summary?.total ?? habits.length;
      // Self-heal: re-establish localStorage if evicted but DB has completions
      if (!lockedIn && dbConfirmed) {
        this._markCheckedIn(challenge.id, today, count, total);
      }
      return this._renderHabitCollapsed(count, total);
    }

    // State B — not yet checked in
    // Default to collapsed state — user can expand to check in from dashboard
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

  // Handle habit toggle from dashboard — local only, no DB write
  _handleDashboardHabitToggle(habitId) {
    if (!this._habitData || !this._habitCheckinPending) return;
    const { habits } = this._habitData;
    const row = document.querySelector(`[data-habit-id="${habitId}"]`);
    if (!row) return;

    const wasChecked = row.dataset.checked === 'true';

    // Toggle in local pending set
    if (wasChecked) {
      this._habitCheckinPending.delete(habitId);
    } else {
      this._habitCheckinPending.add(habitId);
    }

    // Visual checkbox toggle
    row.dataset.checked = String(!wasChecked);
    row.setAttribute('aria-checked', String(!wasChecked));
    const box = row.querySelector('div:first-child');
    const label = row.querySelector('span');
    if (!wasChecked) {
      box.className = 'w-6 h-6 rounded-lg border bg-oura-accent border-oura-accent flex items-center justify-center flex-shrink-0';
      box.innerHTML = '<svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>';
      label.className = 'text-sm text-oura-muted line-through';
    } else {
      box.className = 'w-6 h-6 rounded-lg border border-oura-border flex items-center justify-center flex-shrink-0';
      box.innerHTML = '';
      label.className = 'text-sm text-white';
    }

    // Update counter
    const counter = document.getElementById('habit-counter');
    const completedCount = this._habitCheckinPending.size;
    if (counter) {
      counter.textContent = `${completedCount} of ${habits.length}`;
      counter.className = 'text-xs text-oura-muted';
    }
  },

  // Handle "Check in" confirm button
  async _handleHabitCheckinConfirm() {
    if (!this._habitData || !this._habitCheckinPending) return;
    const { challenge, habits, today } = this._habitData;
    const pending = [...this._habitCheckinPending];
    const btn = document.getElementById('habit-checkin-confirm');

    // Disable button immediately (prevent double-tap)
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving...';
      btn.classList.add('opacity-60');
    }

    try {
      // Batch save to DB
      await Challenges.saveHabitBatch(challenge.id, pending, today);

      // Update local completions to match what was saved
      this._habitData.completions = pending;

      // Lock check-in in localStorage
      this._markCheckedIn(challenge.id, today, pending.length, habits.length);

      // Play celebration animation
      const section = document.getElementById('habit-section');
      if (section) {
        section.classList.remove('habits-complete');
        void section.offsetWidth;
        section.classList.add('habits-complete');
      }

      // Collapse to summary after animation
      setTimeout(() => {
        const section = document.getElementById('habit-section');
        if (section) {
          section.outerHTML = this._renderHabitCollapsed(pending.length, habits.length);
        }
      }, 800);

      // One-shot AI refresh — but NOT if the overlay was skipped earlier.
      // Per spec: "If user later checks in from dashboard — AI insight does NOT re-generate"
      if (!this._overlaySkippedToday) {
        this._refreshAiAfterCheckin();
      }
    } catch (err) {
      console.warn('[Dashboard] Habit check-in failed:', err);
      // Re-enable button on error
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Check in';
        btn.classList.remove('opacity-60');
      }
    }
  },

  // One-shot AI refresh after check-in (no debounce)
  async _refreshAiAfterCheckin() {
    if (this._aiFetchInFlight) return;  // don't stack concurrent fetches
    this._aiFetchInFlight = true;
    try {
      const cached = Cache.get('dashboard');
      const recentSleep = cached?.recentSleep || [];
      const leagueData = cached?.leagueData || null;

      const insight = await this._fetchAiInsight(recentSleep, leagueData, true);
      const ac = document.getElementById('ai-insight-container');
      if (ac && insight) {
        this._aiCardRenderedInsight = insight;
        ac.innerHTML = this._renderAiCard(insight);
      }
    } finally {
      this._aiFetchInFlight = false;
    }
  },

  // Attach click handlers for habit rows and confirm button via event delegation
  _attachHabitListeners(container) {
    // Guard: only attach once per container element (_renderContent is called up to 3x)
    if (container._habitListenerAttached) return;
    container._habitListenerAttached = true;
    container.addEventListener('click', (e) => {
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

      // Confirm button
      if (e.target.closest('#habit-checkin-confirm')) {
        e.stopPropagation();
        this._handleHabitCheckinConfirm();
        return;
      }
      // Habit row toggle
      const row = e.target.closest('.habit-check-row');
      if (row) {
        e.stopPropagation();
        this._handleDashboardHabitToggle(row.dataset.habitId);
      }
    });
  },

  // ── AI Coach Insight ──

  // Extract local bedtime HH:MM from Oura ISO string (e.g. "2026-02-14T23:00:00-06:00" → "23:00")
  // Uses the time as-written in the ISO string, which is the user's local time where they slept.
  // Do NOT convert via new Date().toLocaleTimeString() — that shifts to the browser's current
  // timezone, which is wrong when the user has traveled.
  _formatBedtime(isoStr) {
    if (!isoStr) return null;
    try {
      const match = isoStr.match(/T(\d{2}:\d{2})/);
      return match ? match[1] : null;
    } catch { return null; }
  },

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

  // Build context strings for the AI from available data
  _buildAiContext(recentSleep, leagueData) {
    let sleepContext = '';
    if (recentSleep && recentSleep.length > 0) {
      // Split: LAST NIGHT with full field names (unambiguous for LLM),
      // then TREND DATA with abbreviated keys to save tokens
      const lastNight = recentSleep[0];
      const lastNightObj = {
        date: lastNight.date,
        sleep_score: lastNight.sleep_score,
        total_sleep_minutes: lastNight.total_sleep_minutes,
        deep_sleep_minutes: lastNight.deep_sleep_minutes,
        rem_sleep_minutes: lastNight.rem_sleep_minutes,
        light_sleep_minutes: lastNight.light_sleep_minutes,
        average_hr: lastNight.avg_hr,
        lowest_hr: lastNight.pre_sleep_hr,
        efficiency_score: lastNight.sleep_efficiency_score ?? lastNight.sleep_efficiency,
        hrv: lastNight.hrv,
        bedtime: this._formatBedtime(lastNight.bedtime_start),
        hr_before_sleep: lastNight.hr_before_sleep
      };

      const trend = recentSleep.slice(1).map(d => {
        const entry = {
          date: d.date,
          score: d.sleep_score,
          deep: d.deep_sleep_minutes,
          avgHR: d.avg_hr,
          lowHR: d.pre_sleep_hr,
          total: d.total_sleep_minutes
        };
        const bt = this._formatBedtime(d.bedtime_start);
        if (bt) entry.bedtime = bt;
        if (d.rem_sleep_minutes != null) entry.rem = d.rem_sleep_minutes;
        if (d.light_sleep_minutes != null) entry.light = d.light_sleep_minutes;
        if (d.hrv != null) entry.hrv = d.hrv;
        if (d.sleep_efficiency_score != null) entry.effScore = d.sleep_efficiency_score;
        else if (d.sleep_efficiency != null) entry.eff = d.sleep_efficiency;
        if (d.hr_before_sleep != null) entry.preSleepHR = d.hr_before_sleep;
        return entry;
      });

      sleepContext = `LAST NIGHT:\n${JSON.stringify(lastNightObj)}\n\nTREND DATA (${trend.length} prior nights, newest first):\n${JSON.stringify(trend)}`;
    }

    let habitContext = '';
    if (this._habitData) {
      const { habits, completions } = this._habitData;
      const completedSet = new Set(completions);
      const done = habits.filter(h => completedSet.has(h.id)).map(h => h.title);
      const missed = habits.filter(h => !completedSet.has(h.id)).map(h => h.title);
      habitContext = `Last night's habits: ${done.length} of ${habits.length} completed.`;
      if (done.length > 0) habitContext += ` Done: ${done.join(', ')}.`;
      if (missed.length > 0) habitContext += ` Missed: ${missed.join(', ')}.`;
    }

    let friendContext = '';
    if (leagueData && leagueData.participants) {
      const me = leagueData.participants.find(p => p.isMe);
      const friends = leagueData.participants.filter(p => !p.isMe);
      if (friends.length > 0 && me) {
        // Use actual challenge averages (all nights), not just latest night scores
        const withAvg = leagueData.participants.filter(p => p.challengeAvg != null);
        if (withAvg.length > 0) {
          const challengeAvg = Math.round(withAvg.reduce((s, p) => s + p.challengeAvg, 0) / withAvg.length);
          const myAvg = me.challengeAvg;
          const friendSummary = friends
            .filter(f => f.challengeAvg != null)
            .map(f => `${f.name}: avg ${f.challengeAvg}, last night ${f.score ?? 'no data'}`)
            .join('; ');
          friendContext = `Challenge "${leagueData.challengeName}" day ${leagueData.dayNumber}. Group avg: ${challengeAvg}. Your avg: ${myAvg ?? 'unknown'}, last night: ${me.score ?? 'no data'}. Friends: ${friendSummary}.`;
        }
      }
    }

    return { sleepContext, habitContext, friendContext };
  },

  // Fetch past chat session front matter for AI context
  async _fetchChatContext(challengeId) {
    try {
      const client = SupabaseClient.client;
      const user = await getCurrentUser();
      if (!client || !user) return '';

      const realChallengeId = challengeId === 'personal' ? null : challengeId;
      let query = client.from('ai_chat_sessions')
        .select('date, front_matter')
        .eq('user_id', user.id)
        .neq('front_matter', '{}')
        .order('date', { ascending: false })
        .limit(14);
      query = realChallengeId ? query.eq('challenge_id', realChallengeId) : query.is('challenge_id', null);

      const { data } = await query;
      if (!data || data.length === 0) return '';

      const lines = data
        .filter(s => s.front_matter?.context)
        .map(s => `- ${s.date}: "${s.front_matter.context.slice(0, 100)}"`)
        .join('\n');

      return lines ? `User context from chat sessions:\n${lines}` : '';
    } catch { return ''; }
  },

  // Fetch AI insight (cached per challenge per day)
  // Build a short fingerprint of the data that drives AI insights.
  // If this hasn't changed, there's no reason to call the API again.
  _buildDataFingerprint(recentSleep, leagueData) {
    const latest = recentSleep?.[0];
    const parts = [
      recentSleep?.length || 0,
      latest?.date || '',
      latest?.sleep_score || '',
      latest?.avg_hr || '',
      latest?.deep_sleep_minutes || ''
    ];
    if (leagueData?.participants) {
      parts.push(leagueData.participants.map(p => `${p.name}:${p.score}`).join(','));
    }
    if (this._habitData) {
      parts.push(this._habitData.completions?.length || 0);
    }
    return parts.join('|');
  },

  async _fetchAiInsight(recentSleep, leagueData, forceRefresh, explicitChallengeId) {
    const today = DateUtils.toLocalDateStr(new Date());
    const challengeId = explicitChallengeId || this._habitData?.challenge?.id || 'personal';
    const cacheKey = `ai_insight_${challengeId}_${today}`;
    const fingerprintKey = `ai_insight_fp_${challengeId}_${today}`;
    const currentFingerprint = this._buildDataFingerprint(recentSleep, leagueData);

    if (!forceRefresh) {
      const cached = Cache.get(cacheKey);
      if (cached) return cached;

      // Cache was evicted (e.g. iOS memory pressure) but the data hasn't changed
      // since we last generated an insight — no point calling the API again
      const lastFingerprint = Cache.get(fingerprintKey);
      if (lastFingerprint && lastFingerprint === currentFingerprint) return null;
    }

    const context = this._buildAiContext(recentSleep, leagueData);
    if (!context.sleepContext && !context.habitContext) return null;

    // Fetch past chat front matter (non-blocking fallback to empty)
    const chatContext = await this._fetchChatContext(challengeId);
    if (chatContext) context.chatContext = chatContext;

    try {
      const resp = await fetch('/api/ai/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context)
      });
      if (!resp.ok) return null;
      const { insight } = await resp.json();
      if (insight) {
        Cache.set(cacheKey, insight);
        Cache.set(fingerprintKey, currentFingerprint);
      }
      return insight;
    } catch {
      return null;
    }
  },

  // Render AI card with insight text
  _renderAiCard(insight) {
    if (!insight) return '';
    const lines = insight.split('\n').map(l => l.trim()).filter(Boolean);
    const bullets = lines.filter(l => l.startsWith('- '));
    let body;
    if (bullets.length > 0) {
      body = `<ul class="space-y-4">${bullets.map(b => {
        let text = b.slice(2);
        // Escape non-bold segments, then wrap **bold** in <strong>
        const formatted = text.split(/(\*\*.+?\*\*)/).map(seg =>
          seg.startsWith('**') && seg.endsWith('**')
            ? `<strong class="text-white font-semibold">${escapeHtml(seg.slice(2, -2))}</strong>`
            : escapeHtml(seg)
        ).join('');
        return `<li class="flex gap-2 text-sm text-oura-muted leading-relaxed">
          <span class="text-oura-accent mt-0.5 flex-shrink-0">&bull;</span>
          <span>${formatted}</span>
        </li>`;
      }).join('')}</ul>`;
    } else {
      body = `<p class="text-sm text-oura-muted leading-relaxed">${escapeHtml(insight)}</p>`;
    }
    return `
      <div class="bg-oura-card rounded-2xl p-5 border border-oura-border/30 mb-6 cursor-pointer active:bg-oura-subtle transition-colors" id="ai-card-slot" onclick="Dashboard.openAiChat()">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-oura-muted uppercase tracking-wider">Daily Insight</h3>
          <button onclick="event.stopPropagation(); Dashboard.openContextHistory()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-muted hover:text-oura-accent transition-colors">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </button>
        </div>
        ${body}
        <div class="flex items-center gap-1.5 mt-3 text-oura-accent text-xs">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
          <span>Ask a follow-up</span>
        </div>
      </div>`;
  },

  // Render skeleton loading placeholder for AI card (Savr-style shimmer)
  _renderAiCardLoading() {
    return `
      <div class="bg-oura-card rounded-2xl p-5 border border-oura-border/30 mb-6 ai-skeleton-card" id="ai-card-slot">
        <div class="skeleton-bar w-24 h-3 mb-4"></div>
        <div class="space-y-2.5">
          <div class="flex gap-2 items-start">
            <div class="skeleton-bar w-2 h-2 rounded-full mt-1.5 flex-shrink-0"></div>
            <div class="flex-1 space-y-1.5">
              <div class="skeleton-bar h-3 w-full"></div>
              <div class="skeleton-bar h-3 w-3/4"></div>
            </div>
          </div>
          <div class="flex gap-2 items-start">
            <div class="skeleton-bar w-2 h-2 rounded-full mt-1.5 flex-shrink-0"></div>
            <div class="flex-1 space-y-1.5">
              <div class="skeleton-bar h-3 w-full"></div>
              <div class="skeleton-bar h-3 w-1/2"></div>
            </div>
          </div>
          <div class="flex gap-2 items-start">
            <div class="skeleton-bar w-2 h-2 rounded-full mt-1.5 flex-shrink-0"></div>
            <div class="flex-1 space-y-1.5">
              <div class="skeleton-bar h-3 w-5/6"></div>
            </div>
          </div>
        </div>
        <div class="skeleton-bar w-28 h-3 mt-4"></div>
      </div>`;
  },

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

  // Render the appropriate waiting state based on time of day
  _renderAiWaitingState(recentSleep) {
    if (this._isInBedtimeWindow(recentSleep)) {
      return this._renderAiWaitingForSleep();
    }
    // Daytime: show shimmer skeleton
    return this._renderAiCardLoading();
  },

  // Render dashboard content (separated for caching)
  _renderContent(container, { profile, activeChallenges, recentSleep, leagueData }) {
    try {

      const avgPreSleepHR = this.calcAvgPreSleepHR(recentSleep);
      const avgHR = this.calcAvgHR(recentSleep);
      const avgDeepSleep = this.calcAvgDeepSleep(recentSleep);
      const avgSleepScore = this.calcAvgSleepScore(recentSleep);
      // Chronological order for sparklines
      const chronologicalSleep = [...recentSleep].sort((a, b) => a.date.localeCompare(b.date));

      let html = '';
      const headerEl = document.getElementById('dashboard-header');

      // Hide static "Dashboard" header when league table or welcome state is showing
      const isNewUser = !profile?.oura_token && activeChallenges.length === 0;
      if (headerEl) {
        if ((leagueData && leagueData.participants.length > 0) || isNewUser) {
          headerEl.style.display = 'none';
        } else {
          headerEl.style.display = '';
        }
      }

      // Welcome state for new users — no token AND no active challenge
      if (isNewUser) {
        html += `
          <div class="text-center mb-6 pt-4">
            <h2 class="text-2xl font-bold mb-2">Welcome to Protocol Circle</h2>
            <p class="text-oura-muted text-sm">Connect your Oura Ring and create a challenge to get started.</p>
          </div>
          <div class="space-y-3 mb-6">
            <button onclick="Account.showOuraTokenModal()" class="w-full bg-oura-card rounded-2xl p-5 border border-oura-border/30 text-left">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-full bg-oura-accent/15 flex items-center justify-center flex-shrink-0">
                  <svg class="w-6 h-6 text-oura-accent" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>
                </div>
                <div class="flex-1">
                  <p class="font-semibold mb-0.5">Connect Your Oura Ring</p>
                  <p class="text-sm text-oura-muted">Paste your access token to sync sleep data</p>
                </div>
                <svg class="w-5 h-5 text-oura-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
              </div>
            </button>
            <button onclick="App.navigateTo('protocols')" class="w-full bg-oura-card rounded-2xl p-5 border border-oura-border/30 text-left">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-full bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <svg class="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 0 1-2.021 1.247m0 0A6.015 6.015 0 0 1 12 11.25a6.015 6.015 0 0 1-2.27-.475m4.54 0a6.023 6.023 0 0 0 2.021 1.247m-6.561 0a6.023 6.023 0 0 1-2.021 1.247" /></svg>
                </div>
                <div class="flex-1">
                  <p class="font-semibold mb-0.5">Create a Challenge</p>
                  <p class="text-sm text-oura-muted">Pick a protocol and invite friends to compete</p>
                </div>
                <svg class="w-5 h-5 text-oura-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
              </div>
            </button>
          </div>
        `;
      } else if (!profile?.oura_token) {
        // Existing user with a challenge but no token — show compact prompt
        html += `
          <div class="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 mb-4">
            <div class="flex items-start gap-3">
              <svg class="w-8 h-8 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>
              <div>
                <p class="font-semibold text-amber-400 mb-1">Connect Your Oura Ring</p>
                <p class="text-sm text-oura-muted">Link your Oura ring to see heart rate data and sleep insights.</p>
                <button onclick="Account.showOuraTokenModal()" class="mt-3 px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-500/30 transition-colors">
                  Connect Oura
                </button>
              </div>
            </div>
          </div>
        `;
      }

      if (leagueData && leagueData.participants.length > 0) {
        // Store for swipe handler
        this._leagueData = leagueData;
        const ld = leagueData;
        const progress = Math.min(100, Math.round((ld.dayNumber / 30) * 100));

        html += `
        <div class="mb-4">
          <!-- Page header — replaces "Dashboard" title -->
          <div class="mb-5">
            <p class="text-base font-semibold text-oura-muted uppercase tracking-wider mb-1">Live Standings</p>
            <h2 class="text-2xl font-semibold">${escapeHtml(ld.challengeName)}</h2>
            <div class="flex items-center gap-3 mt-2">
              <span class="text-oura-muted text-sm">Day ${ld.dayNumber}/30</span>
              <div class="flex-1 bg-oura-border rounded-full h-1.5 max-w-[120px]">
                <div class="bg-oura-accent h-1.5 rounded-full" style="width: ${progress}%"></div>
              </div>
            </div>
          </div>
          <!-- Swipeable carousel scoreboard -->
          <div id="league-swipe-area" data-challenge-id="${ld.challengeId}" class="bg-oura-card rounded-2xl border border-oura-border/30 cursor-pointer">
            <div id="league-clip">
              <div id="league-track">
                ${this._leagueMetrics.map((_, i) => `<div class="league-slide p-5 pb-0">${this._renderLeaguePage(leagueData, i)}</div>`).join('')}
              </div>
            </div>
            <div id="league-dots" class="flex justify-center items-center gap-2 px-5 py-4">
              ${this._renderLeagueDots(this._leagueIndex)}
            </div>
          </div>
        </div>`;
      } else {
        // No active challenge — show personal 30-Day Baseline
        html += `
        <div class="bg-oura-card rounded-2xl p-5 mb-4">
          <div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-4">30-Day Average</div>
          <div class="space-y-3">
            <div class="bg-oura-subtle rounded-xl p-3 cursor-pointer hover:bg-oura-border/50 transition-colors flex items-center gap-4" onclick="Dashboard.showMetricDetail('sleep_score')">
              <div class="flex-shrink-0">
                <div class="text-[11px] font-semibold text-purple-400 uppercase tracking-wider mb-1">Sleep Score</div>
                <div class="text-xl font-bold text-purple-400 leading-none">${avgSleepScore !== null ? avgSleepScore : '--'} <span class="text-xs font-normal text-oura-muted">pts</span></div>
              </div>
              <div class="flex-1 h-10 overflow-hidden"><canvas id="sparkline-sleep-score"></canvas></div>
            </div>
            <div class="bg-oura-subtle rounded-xl p-3 cursor-pointer hover:bg-oura-border/50 transition-colors flex items-center gap-4" onclick="Dashboard.showMetricDetail('avg_hr')">
              <div class="flex-shrink-0">
                <div class="text-[11px] font-semibold text-orange-400 uppercase tracking-wider mb-1">Avg HR</div>
                <div class="text-xl font-bold text-orange-400 leading-none">${avgHR !== null ? avgHR : '--'} <span class="text-xs font-normal text-oura-muted">bpm</span></div>
              </div>
              <div class="flex-1 h-10 overflow-hidden"><canvas id="sparkline-avg-hr"></canvas></div>
            </div>
            <div class="bg-oura-subtle rounded-xl p-3 cursor-pointer hover:bg-oura-border/50 transition-colors flex items-center gap-4" onclick="Dashboard.showMetricDetail('pre_sleep_hr')">
              <div class="flex-shrink-0">
                <div class="text-[11px] font-semibold text-teal-400 uppercase tracking-wider mb-1">Lowest HR</div>
                <div class="text-xl font-bold text-teal-400 leading-none">${avgPreSleepHR !== null ? avgPreSleepHR : '--'} <span class="text-xs font-normal text-oura-muted">bpm</span></div>
              </div>
              <div class="flex-1 h-10 overflow-hidden"><canvas id="sparkline-presleep-hr"></canvas></div>
            </div>
            <div class="bg-oura-subtle rounded-xl p-3 cursor-pointer hover:bg-oura-border/50 transition-colors flex items-center gap-4" onclick="Dashboard.showMetricDetail('deep_sleep')">
              <div class="flex-shrink-0">
                <div class="text-[11px] font-semibold text-blue-400 uppercase tracking-wider mb-1">Deep Sleep</div>
                <div class="text-xl font-bold text-blue-400 leading-none">${avgDeepSleep !== null ? avgDeepSleep : '--'} <span class="text-xs font-normal text-oura-muted">min</span></div>
              </div>
              <div class="flex-1 h-10 overflow-hidden"><canvas id="sparkline-deep-sleep"></canvas></div>
            </div>
          </div>
        </div>
        `;

        // Start a challenge CTA (when no active challenges)
        if (activeChallenges.length === 0 && profile?.oura_token) {
          html += `
          <button onclick="App.navigateTo('protocols')" class="w-full bg-oura-card rounded-2xl p-5 mb-4 border border-oura-border/30 border-dashed text-left">
            <div class="flex items-center gap-4">
              <div class="w-10 h-10 rounded-full bg-oura-accent/15 flex items-center justify-center flex-shrink-0">
                <svg class="w-5 h-5 text-oura-accent" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </div>
              <div class="flex-1">
                <p class="font-semibold text-sm">Create a Challenge</p>
                <p class="text-xs text-oura-muted mt-0.5">Pick a protocol and invite friends to compete</p>
              </div>
              <svg class="w-5 h-5 text-oura-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
            </div>
          </button>
          `;
        }

        // Active challenge cards (only when no league table)
        if (activeChallenges.length > 0) {
          html += `<div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-3 mt-2">Active Challenges</div>`;
          for (const ch of activeChallenges) {
            const dayNum = Challenges.getDayNumber(ch.start_date);
            const progress = Math.min(100, Math.round((dayNum / 30) * 100));
            html += `
              <div onclick="App.navigateTo('challenge-detail', '${ch.id}')"
                class="bg-oura-card rounded-2xl p-6 mb-3 cursor-pointer hover:bg-oura-subtle transition-colors">
                <div class="flex items-center gap-4 mb-4">
                  <div class="protocol-icon w-12 h-12 rounded-xl flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">${escapeHtml(Protocols.getInitials(ch.protocol?.name || 'CH'))}</div>
                  <div>
                    <h3 class="font-semibold text-lg">${escapeHtml(ch.name)}</h3>
                    <p class="text-oura-muted text-sm">${escapeHtml(ch.protocol?.name || 'Protocol')}</p>
                  </div>
                </div>
                <div class="mb-2">
                  <div class="flex justify-between text-sm mb-1.5">
                    <span class="text-oura-muted">Day ${dayNum} of 30</span>
                    <span class="text-oura-accent font-medium">${progress}%</span>
                  </div>
                  <div class="w-full bg-oura-border rounded-full h-2">
                    <div class="bg-oura-accent h-2 rounded-full transition-all" style="width: ${progress}%"></div>
                  </div>
                </div>
              </div>
            `;
          }
        }
      }

      // Habit check-in section (below league or baseline)
      html += this._renderHabitSection();

      container.innerHTML = html;

      // Content is painted — dismiss splash screen if still showing
      if (typeof window._dismissSplash === 'function') window._dismissSplash();

      // Initialize sparklines (only when showing baseline)
      if (!leagueData || leagueData.participants.length === 0) {
        this.renderSparkline('sparkline-sleep-score', chronologicalSleep.map(d => d.sleep_score), '#c084fc');
        this.renderSparkline('sparkline-avg-hr', chronologicalSleep.map(d => d.avg_hr), '#fb923c');
        this.renderSparkline('sparkline-presleep-hr', chronologicalSleep.map(d => d.pre_sleep_hr), '#2dd4bf');
        this.renderSparkline('sparkline-deep-sleep', chronologicalSleep.map(d => d.deep_sleep_minutes), '#60a5fa');
      } else {
        // Attach swipe handlers for league scoreboard
        this._attachLeagueSwipe();
      }

      // Attach habit click handlers
      this._attachHabitListeners(container);

      // AI insight card — rendered into a SEPARATE container (ai-insight-container)
      // that lives outside dashboard-container and is NEVER wiped by innerHTML.
      // _renderContent runs up to 3x per render() (cache, fresh, sync); each
      // sets container.innerHTML, which would destroy inline AI cards. By using a
      // sibling container, the AI card persists across all re-renders.
      const aiChallengeId = activeChallenges?.[0]?.id || 'personal';
      const aiContainer = document.getElementById('ai-insight-container');
      if (aiContainer && recentSleep.length > 0 && !this._overlayPending) {
        const today = DateUtils.toLocalDateStr(new Date());
        const cacheKey = `ai_insight_${aiChallengeId}_${today}`;
        const cachedInsight = Cache.get(cacheKey);
        // Check if today's sleep data is present — don't generate new insights
        // with stale data before Oura sync completes. recentSleep is sorted
        // descending by date, so [0] is the most recent night.
        const hasTodayData = recentSleep[0]?.date === today;
        if (cachedInsight) {
          // Skip DOM write if we already rendered this exact insight this cycle
          if (this._aiCardRenderedInsight !== cachedInsight) {
            this._aiCardRenderedInsight = cachedInsight;
            aiContainer.innerHTML = this._renderAiCard(cachedInsight);
          }
        } else if (!this._aiFetchInFlight && !this._aiFetchFailed && hasTodayData) {
          // No cache, no prior failure, no fetch running, today's data is in — show skeleton and start fetch
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
              // Fetch returned nothing — remove skeleton silently, skip future attempts this render
              this._aiFetchFailed = true;
              ac.innerHTML = '';
            }
          }).catch(() => { this._aiFetchInFlight = false; this._aiFetchFailed = true; });
        }
        // If fetch in flight, don't touch aiContainer — let the running fetch fill it
      } else if (aiContainer && recentSleep.length > 0 && !this._overlayPending) {
        // Sleep data exists but no today data and no cached insight — show waiting state
        const hasTodayData = recentSleep[0]?.date === DateUtils.toLocalDateStr(new Date());
        if (!hasTodayData && !this._aiFetchInFlight) {
          aiContainer.innerHTML = this._renderAiWaitingState(recentSleep);
        }
      }
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-2xl p-4">
          <p class="text-red-400">Failed to load dashboard. Please try again.</p>
        </div>
      `;
    }
  },

  // Minimum sleep hours to include (3 hours = 180 minutes)
  MIN_SLEEP_MINUTES: 180,

  // Filter sleep data to only include nights with basic validity
  // Only excludes: very short naps (< 3 hours) and nights missing a sleep score
  filterValidNights(data) {
    if (!data || !Array.isArray(data)) return [];
    return data.filter(d =>
      d.total_sleep_minutes >= this.MIN_SLEEP_MINUTES &&
      d.sleep_score != null
    );
  },

  // Fetch last 30 days of sleep data for baseline view
  async getRecentSleepData() {
    const client = SupabaseClient.client;
    if (!client) return [];

    const user = await SupabaseClient.getCurrentUser();
    if (!user) return [];

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startStr = DateUtils.toLocalDateStr(thirtyDaysAgo);

    const { data, error } = await client
      .from('sleep_data')
      .select('date, avg_hr, sleep_score, total_sleep_minutes, pre_sleep_hr, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes, hrv, sleep_efficiency, sleep_efficiency_score, bedtime_start, hr_before_sleep')
      .eq('user_id', user.id)
      .gte('date', startStr)
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching recent sleep data:', error);
      return [];
    }

    // Filter to only valid nights (>= 5 hours, has all metrics)
    return this.filterValidNights(data || []);
  },

  // Calculate average HR from recent sleep data
  calcAvgHR(sleepData) {
    const hrs = sleepData.filter(d => d.avg_hr != null).map(d => d.avg_hr);
    if (hrs.length === 0) return null;
    return Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
  },

  calcAvgPreSleepHR(sleepData) {
    const vals = sleepData.filter(d => d.pre_sleep_hr != null).map(d => d.pre_sleep_hr);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  },

  calcAvgDeepSleep(sleepData) {
    const vals = sleepData.filter(d => d.deep_sleep_minutes != null).map(d => d.deep_sleep_minutes);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  },

  calcAvgSleepScore(sleepData) {
    const vals = sleepData.filter(d => d.sleep_score != null).map(d => d.sleep_score);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  },

  getMinHR(sleepData) {
    const hrs = sleepData.filter(d => d.avg_hr != null).map(d => d.avg_hr);
    return hrs.length > 0 ? Math.min(...hrs) : '--';
  },

  getMaxHR(sleepData) {
    const hrs = sleepData.filter(d => d.avg_hr != null).map(d => d.avg_hr);
    return hrs.length > 0 ? Math.max(...hrs) : '--';
  },

  // Render a sparkline mini chart into a canvas element
  renderSparkline(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const values = data.filter(v => v != null);
    if (values.length < 2) return;

    // Destroy old chart instance if it exists
    if (this.charts[canvasId]) {
      this.charts[canvasId].destroy();
      delete this.charts[canvasId];
    }

    this.charts[canvasId] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: values.map((_, i) => i),
        datasets: [{
          data: values,
          borderColor: color,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false }
        },
        animation: { duration: 600 }
      }
    });
  },

  // Render friend comparison for a challenge
  async renderFriendComparison(challenge) {
    try {
      const { sleepData } = await Comparison.getChallengeSleepData(challenge.id);
      const hasData = sleepData.some(p => p.data.length > 0);

      if (!hasData) return '';

      // Calculate averages per participant
      const participants = sleepData.map(p => {
        const hrs = p.data.filter(d => d.avg_hr).map(d => d.avg_hr);
        const avg = hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
        return {
          name: p.user.display_name || p.user.email.split('@')[0],
          avgHR: avg
        };
      }).filter(p => p.avgHR !== null);

      if (participants.length < 2) return '';

      return `
        <div class="bg-oura-card rounded-2xl p-6 mb-4">
          <div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-4">Friend Comparison</div>
          <div class="space-y-3">
            ${participants.map((p, i) => {
              const color = i === 0 ? 'text-oura-accent' : 'text-blue-400';
              return `
                <div class="flex items-center justify-between">
                  <span class="text-sm text-oura-muted">${escapeHtml(p.name)}</span>
                  <span class="text-lg font-semibold ${color}">${p.avgHR} <span class="text-xs font-normal text-oura-muted">bpm</span></span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } catch (error) {
      console.error('Error loading friend comparison:', error);
      return '';
    }
  },

  // Fetch last 30 days of sleep data for detail views
  async get30DaySleepData() {
    return this.getSleepData(30);
  },

  // Fetch N days of sleep data for detail views
  async getSleepData(days = 30, { strictFilter = true } = {}) {
    const client = SupabaseClient.client;
    if (!client) return [];

    const user = await SupabaseClient.getCurrentUser();
    if (!user) return [];

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = DateUtils.toLocalDateStr(startDate);

    const { data, error } = await client
      .from('sleep_data')
      .select('date, avg_hr, sleep_score, total_sleep_minutes, pre_sleep_hr, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes, hrv, sleep_efficiency, sleep_efficiency_score, hr_before_sleep')
      .eq('user_id', user.id)
      .gte('date', startStr)
      .order('date', { ascending: true });

    if (error) {
      console.error(`Error fetching ${days}-day sleep data:`, error);
      return [];
    }

    if (strictFilter) {
      return this.filterValidNights(data || []);
    }
    // Lenient filter: only require minimum sleep duration
    return (data || []).filter(d => d.total_sleep_minutes >= this.MIN_SLEEP_MINUTES);
  },

  // Show detail modal for a metric
  async showMetricDetail(metric) {
    const config = {
      sleep_score: { label: 'Sleep Score', unit: 'pts', color: '#c084fc', field: 'sleep_score' },
      avg_hr: { label: 'Average Heart Rate', unit: 'bpm', color: '#fb923c', field: 'avg_hr' },
      pre_sleep_hr: { label: 'Lowest Heart Rate', unit: 'bpm', color: '#2dd4bf', field: 'pre_sleep_hr' },
      deep_sleep: { label: 'Deep Sleep', unit: 'min', color: '#60a5fa', field: 'deep_sleep_minutes' }
    }[metric];

    if (!config) return;

    // Remove any existing modal to prevent duplicates
    this.closeMetricDetail();

    const daysLabel = '30d';

    // Show loading modal immediately
    const modal = document.createElement('div');
    modal.id = 'metric-detail-modal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-oura-bg rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg sm:mx-4 p-6 max-h-[85vh] overflow-y-auto safe-bottom">
        <div class="flex items-center gap-3 mb-6">
          <button onclick="Dashboard.closeMetricDetail()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-accent hover:text-white">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <h3 class="text-lg font-bold" style="color: ${config.color}">${config.label}</h3>
        </div>
        <div class="text-center py-8 text-oura-muted text-sm">Loading ${daysLabel} data...</div>
      </div>
    `;
    modal.addEventListener('click', (e) => { if (e.target === modal) this.closeMetricDetail(); });
    document.body.appendChild(modal);

    // Fetch data (lenient filter — detail view only needs the specific metric)
    const sleepData = await this.getSleepData(30, { strictFilter: false });

    this._renderNumericDetail(modal, sleepData, config, daysLabel);
  },

  _renderNumericDetail(modal, sleepData, config, daysLabel) {
    const values = sleepData.map(d => ({ date: d.date, value: d[config.field] })).filter(d => d.value != null);

    if (values.length === 0) {
      modal.querySelector('.bg-oura-bg').innerHTML = `
        <div class="flex items-center gap-3 mb-6">
          <button onclick="Dashboard.closeMetricDetail()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-accent hover:text-white">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <h3 class="text-lg font-bold" style="color: ${config.color}">${config.label}</h3>
        </div>
        <p class="text-oura-muted text-sm text-center py-8">No data available. Sync your Oura ring to see trends.</p>
      `;
      return;
    }

    const avg = Math.round(values.reduce((s, d) => s + d.value, 0) / values.length);
    const min = Math.round(Math.min(...values.map(d => d.value)));
    const max = Math.round(Math.max(...values.map(d => d.value)));

    modal.querySelector('.bg-oura-bg').innerHTML = `
      <div class="flex items-center gap-3 mb-6">
        <button onclick="Dashboard.closeMetricDetail()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-accent hover:text-white">
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <h3 class="text-lg font-bold" style="color: ${config.color}">${config.label}</h3>
      </div>

      <!-- Summary stats -->
      <div class="flex justify-around mb-6">
        <div class="text-center">
          <div class="text-2xl font-bold" style="color: ${config.color}">${avg}</div>
          <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">${daysLabel} Avg</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-white">${min}</div>
          <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Lowest</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-white">${max}</div>
          <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Highest</div>
        </div>
      </div>

      <!-- Chart -->
      <div class="bg-oura-card rounded-2xl p-4 mb-6">
        <div class="h-48"><canvas id="detail-chart-30d"></canvas></div>
      </div>

      <!-- Daily breakdown -->
      <div class="bg-oura-card rounded-2xl p-4">
        <div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-3">Daily Values</div>
        <div class="space-y-1.5 max-h-60 overflow-y-auto">
          ${[...values].reverse().map(d => {
            const dateObj = new Date(d.date + 'T00:00:00');
            const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            return `
              <div class="flex items-center justify-between py-1.5 border-b border-oura-border/50 last:border-0">
                <span class="text-sm text-oura-muted">${dateStr}</span>
                <span class="text-sm font-medium" style="color: ${config.color}">${Math.round(d.value)} ${config.unit}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Render chart
    const canvas = document.getElementById('detail-chart-30d');
    if (canvas) {
      if (this.charts['detail-chart-30d']) {
        this.charts['detail-chart-30d'].destroy();
        delete this.charts['detail-chart-30d'];
      }

      this.charts['detail-chart-30d'] = new Chart(canvas, {
        type: 'line',
        data: {
          labels: values.map(d => {
            const dt = new Date(d.date + 'T00:00:00');
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }),
          datasets: [{
            data: values.map(d => d.value),
            borderColor: config.color,
            backgroundColor: config.color + '20',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: config.color,
            tension: 0.3,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              // Hex values required by Chart.js API — matches oura-subtle/oura-border tokens
              backgroundColor: '#1a1a2e',
              borderColor: '#2a2a4e',
              borderWidth: 1,
              cornerRadius: 12,
              titleColor: '#fff',
              titleFont: { family: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif" },
              bodyColor: config.color,
              callbacks: {
                label: (ctx) => `${Math.round(ctx.parsed.y)} ${config.unit}`
              }
            }
          },
          scales: {
            x: {
              ticks: { color: '#6b7280', font: { size: 10 }, maxTicksLimit: 7 },
              grid: { display: false }
            },
            y: {
              ticks: { color: '#6b7280', font: { size: 10 } },
              grid: { color: '#ffffff10' }
            }
          }
        }
      });
    }
  },

  closeMetricDetail() {
    // Destroy chart before removing modal
    if (this.charts['detail-chart-30d']) {
      this.charts['detail-chart-30d'].destroy();
      delete this.charts['detail-chart-30d'];
    }
    document.getElementById('metric-detail-modal')?.remove();
  },

  // Contextual motivational message
  getMotivationalMessage(avgHR, challenge) {
    if (!avgHR && !challenge) {
      return 'Connect your Oura ring and start a challenge to begin tracking your sleep health journey.';
    }

    if (!avgHR && challenge) {
      return `You're on day ${Challenges.getDayNumber(challenge.start_date)} of "${escapeHtml(challenge.name)}". Sync your Oura data to see heart rate trends.`;
    }

    if (avgHR && !challenge) {
      if (avgHR < 60) return `Your resting heart rate of ${avgHR} bpm is excellent. Start a challenge to build healthy sleep habits!`;
      if (avgHR < 70) return `Your average of ${avgHR} bpm is solid. A structured sleep protocol could help bring it even lower.`;
      return `Your pre-sleep HR is ${avgHR} bpm. Consistent evening routines can help lower this over time. Try starting a challenge!`;
    }

    // Both HR and challenge exist
    const dayNum = Challenges.getDayNumber(challenge.start_date);
    if (avgHR < 60) {
      return `Outstanding! ${avgHR} bpm on day ${dayNum} of "${escapeHtml(challenge.name)}". Your pre-sleep relaxation is working.`;
    }
    if (avgHR < 70) {
      return `${avgHR} bpm on day ${dayNum} — you're making progress with "${escapeHtml(challenge.name)}". Keep up the evening habits!`;
    }
    return `Day ${dayNum} of "${escapeHtml(challenge.name)}" — your HR is ${avgHR} bpm. Focus on winding down earlier tonight. Consistency is key.`;
  },

  // ── AI Chat ──

  _chatMessages: [],
  _chatContext: null,
  _lastSavedSessionId: null,
  _lastSavedFrontMatter: null,
  _toastDismissTimer: null,

  async openAiChat() {
    const today = DateUtils.toLocalDateStr(new Date());
    const dashData = Cache.get('dashboard');
    const challengeId = dashData?.activeChallenges?.[0]?.id || this._habitData?.challenge?.id || null;
    const chatCacheKey = `ai_chat_${challengeId || 'personal'}_${today}`;
    const insightCacheKey = `ai_insight_${challengeId || 'personal'}_${today}`;

    // Restore from localStorage cache first (instant render)
    const cached = Cache.get(chatCacheKey);
    if (cached && cached.length > 0) {
      this._chatMessages = cached;
    } else {
      const insight = Cache.get(insightCacheKey) || '';
      this._chatMessages = insight
        ? [{ role: 'assistant', content: insight }]
        : [];
    }
    const recentSleep = dashData?.recentSleep || [];
    const leagueData = dashData?.leagueData || null;
    this._chatContext = this._buildAiContext(recentSleep, leagueData);

    this._renderChatModal();

    // Async: try loading from Supabase (may have more messages from another device)
    try {
      const client = SupabaseClient.client;
      const user = await getCurrentUser();
      if (client && user) {
        let query = client.from('ai_chat_sessions')
          .select('id, messages')
          .eq('user_id', user.id)
          .eq('date', today);
        query = challengeId ? query.eq('challenge_id', challengeId) : query.is('challenge_id', null);
        const { data } = await query.maybeSingle();
        if (data && Array.isArray(data.messages) && data.messages.length > this._chatMessages.length) {
          this._chatMessages = data.messages;
          this._renderChatMessages();
        }
      }
    } catch { /* localStorage fallback is fine */ }
  },

  _renderChatModal() {
    document.getElementById('ai-chat-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'ai-chat-modal';
    modal.className = 'fixed inset-0 bg-oura-bg z-50 flex flex-col';
    modal.innerHTML = `
      <div class="safe-top bg-oura-card">
        <div class="flex items-center gap-3 px-4 py-3 border-b border-oura-border/30">
          <button onclick="Dashboard.closeAiChat()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-accent hover:text-white">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <h3 class="text-lg font-semibold">Sleep Coach</h3>
        </div>
      </div>
      <div id="ai-chat-messages" class="flex-1 overflow-y-auto px-4 py-4 space-y-3"></div>
      <div class="safe-bottom bg-oura-card border-t border-oura-border/30">
        <form onsubmit="Dashboard.sendChatMessage(event)" class="px-4 pt-3">
          <div class="flex gap-2">
            <input id="ai-chat-input" type="text" placeholder="Ask about your sleep..." autocomplete="off"
              class="flex-1 px-4 py-3 bg-oura-bg border border-oura-border rounded-xl text-white text-base placeholder-neutral-600 focus:outline-none focus:border-oura-accent">
            <button type="submit" class="min-w-[44px] min-h-[44px] flex items-center justify-center bg-oura-accent rounded-xl text-black">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
            </button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    this._renderChatMessages();
  },

  _renderChatMessages() {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;

    container.innerHTML = this._chatMessages.map(m => {
      if (m.role === 'user') {
        return `<div class="flex justify-end"><div class="max-w-[80%] px-4 py-2.5 rounded-2xl bg-oura-accent text-black text-sm">${escapeHtml(m.content)}</div></div>`;
      }
      const text = m.content || '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const hasBullets = lines.some(l => l.startsWith('- '));
      let html;
      if (hasBullets) {
        html = lines.map(l => {
          if (l.startsWith('- ')) {
            const formatted = l.slice(2).split(/(\*\*.+?\*\*)/).map(seg =>
              seg.startsWith('**') && seg.endsWith('**')
                ? `<strong class="text-white font-semibold">${escapeHtml(seg.slice(2, -2))}</strong>`
                : escapeHtml(seg)
            ).join('');
            return `<div class="flex gap-2"><span class="text-oura-accent flex-shrink-0">&bull;</span><span>${formatted}</span></div>`;
          }
          return `<div>${escapeHtml(l)}</div>`;
        }).join('');
      } else {
        html = escapeHtml(text);
      }
      return `<div class="flex justify-start"><div class="max-w-[80%] px-4 py-2.5 rounded-2xl bg-oura-card border border-oura-border/30 text-sm text-oura-muted leading-relaxed">${html}</div></div>`;
    }).join('');

    container.scrollTop = container.scrollHeight;
  },

  async sendChatMessage(event) {
    event.preventDefault();
    const input = document.getElementById('ai-chat-input');
    const text = (input?.value || '').trim();
    if (!text) return;

    input.value = '';

    this._chatMessages.push({ role: 'user', content: text });
    this._renderChatMessages();

    this._chatMessages.push({ role: 'assistant', content: 'Thinking...' });
    this._renderChatMessages();

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this._chatMessages.filter(m => m.content !== 'Thinking...'),
          sleepContext: this._chatContext?.sleepContext || '',
          habitContext: this._chatContext?.habitContext || ''
        })
      });

      this._chatMessages.pop();

      if (resp.ok) {
        const { reply } = await resp.json();
        this._chatMessages.push({ role: 'assistant', content: reply || 'Sorry, I could not generate a response.' });
      } else {
        this._chatMessages.push({ role: 'assistant', content: 'Something went wrong. Please try again.' });
      }
    } catch {
      this._chatMessages.pop();
      this._chatMessages.push({ role: 'assistant', content: 'Could not reach the server. Please try again.' });
    }

    this._renderChatMessages();
    this._saveChatToCache();
    this._saveChatToSupabase(); // fire-and-forget
  },

  _saveChatToCache() {
    const today = DateUtils.toLocalDateStr(new Date());
    const challengeId = this._habitData?.challenge?.id || 'personal';
    const key = `ai_chat_${challengeId}_${today}`;
    const toSave = this._chatMessages.slice(-20);
    Cache.set(key, toSave, 24 * 60 * 60 * 1000);
  },

  async _saveChatToSupabase() {
    try {
      const client = SupabaseClient.client;
      const user = await getCurrentUser();
      if (!client || !user) return;

      const today = DateUtils.toLocalDateStr(new Date());
      const dashData = Cache.get('dashboard');
      const challengeId = dashData?.activeChallenges?.[0]?.id || this._habitData?.challenge?.id || null;
      const toSave = this._chatMessages.slice(-20);

      const row = {
        user_id: user.id,
        challenge_id: challengeId,
        date: today,
        messages: toSave,
        updated_at: new Date().toISOString()
      };

      await client.from('ai_chat_sessions').upsert(row, {
        onConflict: 'user_id,challenge_id,date'
      });
    } catch { /* non-blocking — localStorage is the offline fallback */ }
  },

  _buildFrontMatter() {
    const userMsgs = this._chatMessages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ');
    const context = userMsgs.slice(0, 200);

    const dashData = Cache.get('dashboard');
    const recentSleep = dashData?.recentSleep || [];
    const todaySleep = recentSleep[0];

    const fm = { context };
    if (todaySleep?.sleep_score) fm.sleep_score = todaySleep.sleep_score;

    if (this._habitData) {
      const { habits, completions } = this._habitData;
      const completedSet = new Set(completions);
      fm.habits = {
        done: habits.filter(h => completedSet.has(h.id)).map(h => h.title),
        missed: habits.filter(h => !completedSet.has(h.id)).map(h => h.title)
      };
    }

    return fm;
  },

  async _saveFrontMatter(frontMatter) {
    try {
      const client = SupabaseClient.client;
      const user = await getCurrentUser();
      if (!client || !user) return null;

      const today = DateUtils.toLocalDateStr(new Date());
      const dashData = Cache.get('dashboard');
      const challengeId = dashData?.activeChallenges?.[0]?.id || this._habitData?.challenge?.id || null;

      const row = {
        user_id: user.id,
        challenge_id: challengeId,
        date: today,
        front_matter: frontMatter,
        updated_at: new Date().toISOString()
      };

      const { data } = await client.from('ai_chat_sessions').upsert(row, {
        onConflict: 'user_id,challenge_id,date'
      }).select('id').maybeSingle();

      return data?.id || null;
    } catch { return null; }
  },

  closeAiChat() {
    const hasUserMessages = this._chatMessages.some(m => m.role === 'user');

    if (hasUserMessages) {
      const frontMatter = this._buildFrontMatter();
      this._lastSavedFrontMatter = frontMatter;
      this._cleanAndSaveContext(frontMatter);
    }

    this._chatMessages = [];
    this._chatContext = null;
    document.getElementById('ai-chat-modal')?.remove();
  },

  async _cleanAndSaveContext(frontMatter) {
    if (frontMatter.context) {
      try {
        const resp = await fetch('/api/ai/clean-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawContext: frontMatter.context })
        });
        if (resp.ok) {
          const { cleaned } = await resp.json();
          if (cleaned) frontMatter.context = cleaned;
        }
      } catch { /* fall back to raw context */ }
    }

    this._lastSavedFrontMatter = frontMatter;
    const sessionId = await this._saveFrontMatter(frontMatter);
    this._lastSavedSessionId = sessionId;
    this._showContextSavedToast(frontMatter);
  },

  _showContextSavedToast(frontMatter) {
    document.getElementById('context-toast')?.remove();
    clearTimeout(this._toastDismissTimer);

    const preview = (frontMatter.context || '').slice(0, 80);
    const toast = document.createElement('div');
    toast.id = 'context-toast';
    toast.className = 'fixed left-4 right-4 bottom-20 z-40 toast-enter';
    toast.innerHTML = `
      <div class="bg-oura-card rounded-2xl p-4 border border-oura-border/30 shadow-lg">
        <div id="toast-display">
          <div class="flex items-start gap-3">
            <svg class="w-5 h-5 text-oura-accent flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-white">Context saved</p>
              <p class="text-xs text-oura-muted mt-1 truncate">${escapeHtml(preview)}${preview.length < (frontMatter.context || '').length ? '...' : ''}</p>
            </div>
            <button onclick="Dashboard._dismissToast()" class="text-oura-muted hover:text-white flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 -mt-2">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <button onclick="Dashboard._editToastContext()" class="mt-3 text-xs text-oura-accent">Edit context</button>
        </div>
        <div id="toast-edit" class="hidden">
          <textarea id="toast-edit-textarea" rows="3"
            class="w-full px-3 py-2 bg-oura-bg border border-oura-border rounded-xl text-white text-base placeholder-neutral-600 focus:outline-none focus:border-oura-accent resize-none"></textarea>
          <div class="flex gap-2 mt-2">
            <button onclick="Dashboard._saveEditedContext()" class="flex-1 py-2 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black text-sm font-semibold rounded-xl">Save</button>
            <button onclick="Dashboard._cancelEditContext()" class="flex-1 py-2 text-oura-muted text-sm rounded-xl border border-oura-border">Cancel</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(toast);

    this._toastDismissTimer = setTimeout(() => this._dismissToast(), 8000);
  },

  _dismissToast() {
    clearTimeout(this._toastDismissTimer);
    const toast = document.getElementById('context-toast');
    if (!toast) return;
    toast.classList.remove('toast-enter');
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 250);
  },

  _editToastContext() {
    clearTimeout(this._toastDismissTimer);
    const display = document.getElementById('toast-display');
    const edit = document.getElementById('toast-edit');
    const textarea = document.getElementById('toast-edit-textarea');
    if (!display || !edit || !textarea) return;
    display.classList.add('hidden');
    edit.classList.remove('hidden');
    textarea.value = this._lastSavedFrontMatter?.context || '';
    textarea.focus();
  },

  _cancelEditContext() {
    const display = document.getElementById('toast-display');
    const edit = document.getElementById('toast-edit');
    if (!display || !edit) return;
    edit.classList.add('hidden');
    display.classList.remove('hidden');
    this._toastDismissTimer = setTimeout(() => this._dismissToast(), 5000);
  },

  async _saveEditedContext() {
    const textarea = document.getElementById('toast-edit-textarea');
    const newContext = (textarea?.value || '').trim();
    if (!newContext || !this._lastSavedFrontMatter) {
      this._dismissToast();
      return;
    }

    this._lastSavedFrontMatter.context = newContext;

    try {
      const client = SupabaseClient.client;
      const user = await getCurrentUser();
      if (client && user && this._lastSavedSessionId) {
        await client.from('ai_chat_sessions')
          .update({ front_matter: this._lastSavedFrontMatter, updated_at: new Date().toISOString() })
          .eq('id', this._lastSavedSessionId);
      } else {
        // No session ID yet — do a full upsert
        await this._saveFrontMatter(this._lastSavedFrontMatter);
      }
    } catch { /* best-effort */ }

    this._dismissToast();
  },

  async openContextHistory() {
    const client = SupabaseClient.client;
    const user = await SupabaseClient.getCurrentUser();
    if (!client || !user) return;

    const { data } = await client
      .from('ai_chat_sessions')
      .select('date, front_matter')
      .eq('user_id', user.id)
      .not('front_matter->>context', 'is', null)
      .neq('front_matter->>context', '')
      .order('date', { ascending: false })
      .limit(30);

    this.closeContextHistory();

    const modal = document.createElement('div');
    modal.id = 'context-history-modal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50';

    const entries = data && data.length > 0
      ? data.map(row => {
          const fm = row.front_matter;
          const dateObj = new Date(row.date + 'T00:00:00');
          const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          let details = '';
          if (fm.sleep_score) details += `<span class="text-oura-accent">${fm.sleep_score} pts</span>`;
          if (fm.habits) {
            const done = fm.habits.done?.length || 0;
            const missed = fm.habits.missed?.length || 0;
            if (done || missed) details += `${details ? '<span class="text-oura-border mx-1.5">|</span>' : ''}<span class="text-oura-muted">${done}/${done + missed} habits</span>`;
          }
          return `
            <div class="py-3 border-b border-oura-border/30 last:border-0">
              <div class="flex items-center justify-between mb-1">
                <div class="text-xs font-medium text-oura-muted">${dateStr}</div>
                ${details ? `<div class="text-xs">${details}</div>` : ''}
              </div>
              <div class="text-sm text-white">${escapeHtml(fm.context)}</div>
            </div>`;
        }).join('')
      : '<p class="text-sm text-oura-muted py-4">No context entries yet. Add context in the AI chat to track what affects your sleep.</p>';

    modal.innerHTML = `
      <div class="bg-oura-bg rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg sm:mx-4 p-6 max-h-[85vh] overflow-y-auto safe-bottom">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-white">Context History</h3>
          <button onclick="Dashboard.closeContextHistory()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-accent hover:text-white">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div>${entries}</div>
      </div>
    `;

    modal.addEventListener('click', (e) => { if (e.target === modal) this.closeContextHistory(); });
    document.body.appendChild(modal);
  },

  closeContextHistory() {
    document.getElementById('context-history-modal')?.remove();
  }
};

// Export for use in other modules
window.Dashboard = Dashboard;
