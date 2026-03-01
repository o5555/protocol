// Performance Dashboard Module

const Dashboard = {
  // Chart instances for cleanup (prevent memory leaks)
  charts: {},

  // Render generation counter to prevent stale async callbacks from overwriting fresher renders
  _renderGeneration: 0,

  // Habit + AI state
  _habitData: null,
  _aiRefreshTimer: null,

  // Main render entry point
  async render() {
    const container = document.getElementById('dashboard-container');
    if (!container) return;

    const generation = ++this._renderGeneration;

    // Try to render instantly from cache (but always refresh in background)
    const cachedData = Cache.get('dashboard');
    if (cachedData) {
      this._renderContent(container, cachedData);
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

      // Fetch league data for first active challenge
      let leagueData = null;
      if (activeChallenges.length > 0) {
        try {
          const result = await Comparison.getChallengeSleepData(activeChallenges[0].id);
          if (generation !== this._renderGeneration) return;
          const currentUser = await SupabaseClient.getCurrentUser();
          leagueData = this._buildLeagueData(result, currentUser?.id);
        } catch (e) {
          console.warn('[Dashboard] League data fetch failed:', e);
        }
      }

      // Fetch habit data for active challenge
      await this._fetchHabitData(activeChallenges, generation);
      if (generation !== this._renderGeneration) return;

      // Cache the data
      Cache.set('dashboard', { profile, activeChallenges, recentSleep, leagueData });

      // Re-render with fresh data
      this._renderContent(container, { profile, activeChallenges, recentSleep, leagueData });

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
    { key: 'deep',  label: 'Deep Sleep', unit: 'min', lowerIsBetter: false }
  ],
  _leagueIndex: 0,

  // Build league data from challenge comparison result
  _buildLeagueData(result, currentUserId) {
    const { challenge, sleepData } = result;
    if (!sleepData || sleepData.length === 0) return null;

    const participants = sleepData.map(p => {
      const cd = p.challengeData || [];
      // Most recent night (challengeData is sorted ascending by date)
      const latest = cd.length > 0 ? cd[cd.length - 1] : {};
      return {
        name: p.user.display_name || p.user.email.split('@')[0],
        isMe: p.user.id === currentUserId,
        score: latest.sleep_score ?? null,
        hr: latest.avg_hr ?? null,
        low: latest.pre_sleep_hr ?? null,
        deep: latest.deep_sleep_minutes ?? null
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
            <span class="text-2xl font-bold ${valColor}">${val ?? '--'}</span>
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
    this._habitData = null;
    if (!activeChallenges || activeChallenges.length === 0) return;

    const challenge = activeChallenges[0];
    // Skip if challenge hasn't started yet
    if (Challenges.getDayNumber(challenge.start_date) === 0) return;

    try {
      const client = SupabaseClient.client;
      const user = await SupabaseClient.getCurrentUser();
      if (!client || !user) return;
      if (generation !== this._renderGeneration) return;

      const today = DateUtils.toLocalDateStr(new Date());

      // Fetch protocol habits and today's completions in parallel
      const [habitsResult, completions] = await Promise.all([
        client.from('protocol_habits')
          .select('id, title, sort_order')
          .eq('protocol_id', challenge.protocol.id)
          .order('sort_order'),
        Challenges.getHabitCompletions(challenge.id, user.id, today)
      ]);

      if (generation !== this._renderGeneration) return;

      let habits = habitsResult.data || [];
      // Filter by mode (light vs pro)
      if (challenge.mode === 'light') {
        const protocol = { ...challenge.protocol, habits };
        habits = Protocols.getHabitsForMode(protocol, 'light');
      }

      this._habitData = { challenge, habits, completions, today };
    } catch (e) {
      console.warn('[Dashboard] Habit data fetch failed:', e);
    }
  },

  // Render the habit check-in section
  _renderHabitSection() {
    if (!this._habitData) return '';
    const { habits, completions } = this._habitData;
    if (!habits || habits.length === 0) return '';

    const completedSet = new Set(completions);
    const completedCount = completedSet.size;

    return `
      <div class="bg-oura-card rounded-2xl p-4 border border-oura-border/30 mb-3" id="habit-section">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-oura-muted uppercase tracking-wider">Today's Habits</h3>
          <span id="habit-counter" class="text-xs text-oura-muted">${completedCount} of ${habits.length}</span>
        </div>
        <div class="space-y-0 divide-y divide-oura-border/20">
          ${habits.map(h => {
            const checked = completedSet.has(h.id);
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
      </div>`;
  },

  // Handle habit toggle from dashboard
  async _handleDashboardHabitToggle(habitId) {
    if (!this._habitData) return;
    const { challenge, habits, completions, today } = this._habitData;
    const row = document.querySelector(`[data-habit-id="${habitId}"]`);
    if (!row) return;

    const wasChecked = row.dataset.checked === 'true';

    // Optimistic UI update
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

    // Update local completions array and counter
    if (!wasChecked) {
      completions.push(habitId);
    } else {
      const idx = completions.indexOf(habitId);
      if (idx !== -1) completions.splice(idx, 1);
    }
    const counter = document.getElementById('habit-counter');
    const completedCount = new Set(completions).size;
    if (counter) counter.textContent = `${completedCount} of ${habits.length}`;

    // Celebrate when all habits are checked off
    if (!wasChecked && completedCount === habits.length) {
      const section = document.getElementById('habit-section');
      if (section) {
        section.classList.remove('habits-complete');
        void section.offsetWidth; // force reflow to restart animation
        section.classList.add('habits-complete');
      }
      if (counter) {
        counter.textContent = 'All done';
        counter.className = 'text-xs text-oura-accent font-semibold';
      }
    } else if (counter) {
      counter.className = 'text-xs text-oura-muted';
    }

    try {
      await Challenges.toggleHabit(challenge.id, habitId, today);
      // Trigger debounced AI refresh
      this._scheduleAiRefresh();
    } catch (err) {
      console.warn('[Dashboard] Habit toggle failed:', err);
      // Revert optimistic update
      row.dataset.checked = String(wasChecked);
      row.setAttribute('aria-checked', String(wasChecked));
      if (wasChecked) {
        box.className = 'w-6 h-6 rounded-lg border bg-oura-accent border-oura-accent flex items-center justify-center flex-shrink-0';
        box.innerHTML = '<svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>';
        label.className = 'text-sm text-oura-muted line-through';
      } else {
        box.className = 'w-6 h-6 rounded-lg border border-oura-border flex items-center justify-center flex-shrink-0';
        box.innerHTML = '';
        label.className = 'text-sm text-white';
      }
      // Revert completions array
      if (wasChecked) {
        completions.push(habitId);
      } else {
        const idx = completions.indexOf(habitId);
        if (idx !== -1) completions.splice(idx, 1);
      }
      const revertCount = new Set(completions).size;
      if (counter) {
        counter.textContent = `${revertCount} of ${habits.length}`;
        counter.className = 'text-xs text-oura-muted';
      }
      const section = document.getElementById('habit-section');
      if (section) section.classList.remove('habits-complete');
    }
  },

  // Attach click handler for habit rows via event delegation
  _attachHabitListeners(container) {
    container.addEventListener('click', (e) => {
      const row = e.target.closest('.habit-check-row');
      if (row) {
        e.stopPropagation();
        this._handleDashboardHabitToggle(row.dataset.habitId);
      }
    });
  },

  // ── AI Coach Insight ──

  // Build context strings for the AI from available data
  _buildAiContext(recentSleep, leagueData) {
    let sleepContext = '';
    if (recentSleep && recentSleep.length > 0) {
      const last = recentSleep[0]; // most recent night (desc order)
      const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
      const scores = recentSleep.filter(d => d.sleep_score).map(d => d.sleep_score);
      const hrs = recentSleep.filter(d => d.avg_hr).map(d => d.avg_hr);
      const lows = recentSleep.filter(d => d.pre_sleep_hr).map(d => d.pre_sleep_hr);
      const deeps = recentSleep.filter(d => d.deep_sleep_minutes).map(d => d.deep_sleep_minutes);

      sleepContext = `Last night: sleep score ${last.sleep_score || 'unknown'}, avg HR ${last.avg_hr || 'unknown'} bpm, lowest HR ${last.pre_sleep_hr || 'unknown'} bpm, deep sleep ${last.deep_sleep_minutes || 'unknown'} min.`;
      sleepContext += `\n7-day averages: score ${avg(scores.slice(0, 7)) || 'unknown'}, avg HR ${avg(hrs.slice(0, 7)) || 'unknown'}, lowest HR ${avg(lows.slice(0, 7)) || 'unknown'}, deep ${avg(deeps.slice(0, 7)) || 'unknown'} min.`;
    }

    let habitContext = '';
    if (this._habitData) {
      const { habits, completions } = this._habitData;
      const completedSet = new Set(completions);
      const done = habits.filter(h => completedSet.has(h.id)).map(h => h.title);
      const missed = habits.filter(h => !completedSet.has(h.id)).map(h => h.title);
      habitContext = `Habits completed: ${done.length} of ${habits.length}.`;
      if (done.length > 0) habitContext += ` Done: ${done.join(', ')}.`;
      if (missed.length > 0) habitContext += ` Missed: ${missed.join(', ')}.`;
    }

    let friendContext = '';
    if (leagueData && leagueData.participants) {
      const me = leagueData.participants.find(p => p.isMe);
      const friends = leagueData.participants.filter(p => !p.isMe);
      if (friends.length > 0 && me) {
        const avgScore = Math.round(
          leagueData.participants.reduce((s, p) => s + (p.score || 0), 0) / leagueData.participants.length
        );
        const standout = friends.find(f => f.score && f.score >= avgScore + 10);
        if (standout) {
          friendContext = `Notable: ${standout.name} scored ${standout.score} (challenge avg ${avgScore}). You scored ${me.score || 'unknown'}.`;
        }
      }
    }

    return { sleepContext, habitContext, friendContext };
  },

  // Fetch AI insight (cached per challenge per day)
  async _fetchAiInsight(recentSleep, leagueData, forceRefresh, explicitChallengeId) {
    const today = DateUtils.toLocalDateStr(new Date());
    const challengeId = explicitChallengeId || this._habitData?.challenge?.id || 'personal';
    const cacheKey = `ai_insight_${challengeId}_${today}`;

    if (!forceRefresh) {
      const cached = Cache.get(cacheKey);
      if (cached) return cached;
    }

    const context = this._buildAiContext(recentSleep, leagueData);
    if (!context.sleepContext && !context.habitContext) return null;

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
  },

  // Render AI card with insight text
  _renderAiCard(insight) {
    if (!insight) return '';
    const lines = insight.split('\n').map(l => l.trim()).filter(Boolean);
    const bullets = lines.filter(l => l.startsWith('- '));
    let body;
    if (bullets.length > 0) {
      body = `<ul class="space-y-2">${bullets.map(b =>
        `<li class="flex gap-2 text-sm text-oura-muted leading-relaxed">
          <span class="text-oura-accent mt-0.5 flex-shrink-0">&bull;</span>
          <span>${escapeHtml(b.slice(2))}</span>
        </li>`).join('')}</ul>`;
    } else {
      body = `<p class="text-sm text-oura-muted leading-relaxed">${escapeHtml(insight)}</p>`;
    }
    return `
      <div class="bg-oura-card rounded-2xl p-5 border border-oura-border/30 mb-6 cursor-pointer active:bg-oura-subtle transition-colors" id="ai-card-slot" onclick="Dashboard.openAiChat()">
        <h3 class="text-sm font-bold text-oura-muted uppercase tracking-wider mb-3">Daily Insight</h3>
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

  // Debounced AI refresh after habit toggles (3s after last toggle)
  _scheduleAiRefresh() {
    clearTimeout(this._aiRefreshTimer);
    this._aiRefreshTimer = setTimeout(async () => {
      // Use cached dashboard data for sleep/league context
      const cached = Cache.get('dashboard');
      const recentSleep = cached?.recentSleep || [];
      const leagueData = cached?.leagueData || null;

      const insight = await this._fetchAiInsight(recentSleep, leagueData, true);
      const slot = document.getElementById('ai-card-slot');
      if (slot && insight) {
        const temp = document.createElement('div');
        temp.innerHTML = this._renderAiCard(insight);
        slot.replaceWith(temp.firstElementChild);
      }
    }, 3000);
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

      // Hide static "Dashboard" header when league table is showing
      if (headerEl) {
        if (leagueData && leagueData.participants.length > 0) {
          headerEl.style.display = 'none';
        } else {
          headerEl.style.display = '';
        }
      }

      // No-token prompt
      if (!profile?.oura_token) {
        html += `
          <div class="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 mb-4">
            <div class="flex items-start gap-3">
              <svg class="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>
              <div>
                <p class="font-semibold text-amber-400 mb-1">Connect Your Oura Ring</p>
                <p class="text-sm text-oura-muted">Link your Oura ring to see heart rate data and sleep insights.</p>
                <button onclick="App.navigateTo('account')" class="mt-3 px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-500/30 transition-colors">
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
                  <div class="protocol-icon w-12 h-12 rounded-xl flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">${Protocols.getInitials(ch.protocol?.name || 'CH')}</div>
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

      // AI insight card (below habits) — shows whenever there's sleep data
      // Use activeChallenges for cache key (not _habitData which may not be populated yet)
      const aiChallengeId = activeChallenges?.[0]?.id || 'personal';
      if (recentSleep.length > 0) {
        const today = DateUtils.toLocalDateStr(new Date());
        const cacheKey = `ai_insight_${aiChallengeId}_${today}`;
        const cachedInsight = Cache.get(cacheKey);
        html += cachedInsight ? this._renderAiCard(cachedInsight) : this._renderAiCardLoading();
      }

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

      // Async: fetch AI insight if not cached
      if (recentSleep.length > 0) {
        const today = DateUtils.toLocalDateStr(new Date());
        const cacheKey = `ai_insight_${aiChallengeId}_${today}`;
        if (!Cache.get(cacheKey)) {
          const gen = this._renderGeneration;
          this._fetchAiInsight(recentSleep, leagueData, false, aiChallengeId).then(insight => {
            if (gen !== this._renderGeneration) return; // stale callback — a newer render owns the DOM
            const slot = document.getElementById('ai-card-slot');
            if (slot && insight) {
              // Replace the loading card with the full tappable AI card
              const temp = document.createElement('div');
              temp.innerHTML = this._renderAiCard(insight);
              slot.replaceWith(temp.firstElementChild);
            } else if (slot && !insight) {
              slot.style.transition = 'opacity 0.3s ease';
              slot.style.opacity = '0';
              setTimeout(() => slot.remove(), 300);
            }
          });
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

  // Minimum sleep hours to include (5 hours = 300 minutes)
  MIN_SLEEP_MINUTES: 300,

  // Filter sleep data to only include complete, valid nights
  // Removes: nights < 5 hours, missing sleep score, missing HR data, missing deep sleep
  filterValidNights(data) {
    if (!data || !Array.isArray(data)) return [];
    return data.filter(d =>
      d.total_sleep_minutes >= this.MIN_SLEEP_MINUTES &&
      d.sleep_score != null &&
      d.pre_sleep_hr != null &&
      d.avg_hr != null &&
      d.deep_sleep_minutes != null
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
      .select('date, avg_hr, sleep_score, total_sleep_minutes, pre_sleep_hr, deep_sleep_minutes')
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
      .select('date, avg_hr, sleep_score, total_sleep_minutes, pre_sleep_hr, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes')
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
      return `You're on day ${Challenges.getDayNumber(challenge.start_date)} of "${challenge.name}". Sync your Oura data to see heart rate trends.`;
    }

    if (avgHR && !challenge) {
      if (avgHR < 60) return `Your resting heart rate of ${avgHR} bpm is excellent. Start a challenge to build healthy sleep habits!`;
      if (avgHR < 70) return `Your average of ${avgHR} bpm is solid. A structured sleep protocol could help bring it even lower.`;
      return `Your pre-sleep HR is ${avgHR} bpm. Consistent evening routines can help lower this over time. Try starting a challenge!`;
    }

    // Both HR and challenge exist
    const dayNum = Challenges.getDayNumber(challenge.start_date);
    if (avgHR < 60) {
      return `Outstanding! ${avgHR} bpm on day ${dayNum} of "${challenge.name}". Your pre-sleep relaxation is working.`;
    }
    if (avgHR < 70) {
      return `${avgHR} bpm on day ${dayNum} — you're making progress with "${challenge.name}". Keep up the evening habits!`;
    }
    return `Day ${dayNum} of "${challenge.name}" — your HR is ${avgHR} bpm. Focus on winding down earlier tonight. Consistency is key.`;
  },

  // ── AI Chat ──

  _chatMessages: [],
  _chatContext: null,

  openAiChat() {
    // Get current insight from the card
    const today = DateUtils.toLocalDateStr(new Date());
    const dashData = Cache.get('dashboard');
    const challengeId = dashData?.activeChallenges?.[0]?.id || this._habitData?.challenge?.id || 'personal';
    const chatCacheKey = `ai_chat_${challengeId}_${today}`;
    const insightCacheKey = `ai_insight_${challengeId}_${today}`;

    // Restore from cache or seed with current insight
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
  },

  _renderChatModal() {
    // Remove existing
    document.getElementById('ai-chat-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'ai-chat-modal';
    modal.className = 'fixed inset-0 bg-oura-bg z-50 flex flex-col';
    modal.innerHTML = `
      <div class="flex items-center gap-3 px-4 pt-safe-top pb-3 border-b border-oura-border/30 bg-oura-card">
        <button onclick="Dashboard.closeAiChat()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-accent hover:text-white">
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <h3 class="text-lg font-semibold">Sleep Coach</h3>
      </div>
      <div id="ai-chat-messages" class="flex-1 overflow-y-auto px-4 py-4 space-y-3"></div>
      <form onsubmit="Dashboard.sendChatMessage(event)" class="px-4 pb-safe-bottom pt-3 border-t border-oura-border/30 bg-oura-card">
        <div class="flex gap-2">
          <input id="ai-chat-input" type="text" placeholder="Ask about your sleep..." autocomplete="off"
            class="flex-1 px-4 py-3 bg-oura-bg border border-oura-border rounded-xl text-white text-base placeholder-neutral-600 focus:outline-none focus:border-oura-accent">
          <button type="submit" class="min-w-[44px] min-h-[44px] flex items-center justify-center bg-oura-accent rounded-xl text-black">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
          </button>
        </div>
      </form>
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
      // AI message — parse bullets
      const text = m.content || '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const hasBullets = lines.some(l => l.startsWith('- '));
      let html;
      if (hasBullets) {
        html = lines.map(l => {
          if (l.startsWith('- ')) {
            return `<div class="flex gap-2"><span class="text-oura-accent flex-shrink-0">&bull;</span><span>${escapeHtml(l.slice(2))}</span></div>`;
          }
          return `<div>${escapeHtml(l)}</div>`;
        }).join('');
      } else {
        html = escapeHtml(text);
      }
      return `<div class="flex justify-start"><div class="max-w-[80%] px-4 py-2.5 rounded-2xl bg-oura-card border border-oura-border/30 text-sm text-oura-muted leading-relaxed">${html}</div></div>`;
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  },

  async sendChatMessage(event) {
    event.preventDefault();
    const input = document.getElementById('ai-chat-input');
    const text = (input?.value || '').trim();
    if (!text) return;

    input.value = '';

    // Add user message
    this._chatMessages.push({ role: 'user', content: text });
    this._renderChatMessages();

    // Add thinking placeholder
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

      // Remove thinking placeholder
      this._chatMessages.pop();

      if (resp.ok) {
        const { reply } = await resp.json();
        this._chatMessages.push({ role: 'assistant', content: reply || 'Sorry, I could not generate a response.' });
      } else {
        this._chatMessages.push({ role: 'assistant', content: 'Something went wrong. Please try again.' });
      }
    } catch {
      this._chatMessages.pop(); // remove thinking
      this._chatMessages.push({ role: 'assistant', content: 'Could not reach the server. Please try again.' });
    }

    this._renderChatMessages();
    this._saveChatToCache();
  },

  _saveChatToCache() {
    const today = DateUtils.toLocalDateStr(new Date());
    const challengeId = this._habitData?.challenge?.id || 'personal';
    const key = `ai_chat_${challengeId}_${today}`;
    // Keep max 20 messages
    const toSave = this._chatMessages.slice(-20);
    Cache.set(key, toSave, 24 * 60 * 60 * 1000);
  },

  closeAiChat() {
    this._chatMessages = [];
    this._chatContext = null;
    document.getElementById('ai-chat-modal')?.remove();
  }
};

// Export for use in other modules
window.Dashboard = Dashboard;
