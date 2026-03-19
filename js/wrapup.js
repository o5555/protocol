// Challenge Wrap-Up Experience
// Full-screen swipeable card overlay shown when a challenge ends.

const Wrapup = {
  _currentIndex: 0,
  _totalCards: 5,
  _data: null,
  _aiContent: null,
  _aiFetchInFlight: false,

  // ── Public API ──

  show(challengeData) {
    if (document.getElementById('wrapup-overlay')) return;
    this._data = challengeData;
    this._currentIndex = 0;
    this._aiContent = null;

    // Check localStorage cache for AI content
    const cacheKey = 'wrapup_ai_' + (challengeData.challenge?.id || 'unknown');
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) this._aiContent = JSON.parse(cached);
    } catch { /* ignore */ }

    // Build overlay
    const wrapper = document.createElement('div');
    wrapper.id = 'wrapup-overlay';
    wrapper.className = 'fixed inset-0 bg-oura-bg z-50 safe-area-overlay';
    wrapper.innerHTML = this._renderOverlay();
    document.body.appendChild(wrapper);

    // Attach swipe + click handlers
    this._attachSwipe(wrapper);
    this._attachClicks(wrapper);

    // Start AI fetch if not cached
    if (!this._aiContent) {
      this._fetchAi();
    }
  },

  dismiss() {
    const overlay = document.getElementById('wrapup-overlay');
    if (!overlay) return;
    overlay.style.transition = 'opacity 200ms ease-out';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  },

  // ── Overlay Structure ──

  _renderOverlay() {
    return `
      <button onclick="Wrapup.dismiss()" class="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-oura-subtle text-oura-muted" aria-label="Close">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
      </button>
      <div id="wrapup-clip" class="overflow-hidden h-full">
        <div id="wrapup-track" class="flex h-full wrapup-track" style="touch-action: pan-y">
          ${this._renderCard1()}
          ${this._renderCard2()}
          ${this._renderCard3()}
          ${this._renderCard4()}
          ${this._renderCard5()}
        </div>
      </div>
      <div id="wrapup-dots" class="absolute bottom-6 left-0 right-0 flex justify-center gap-2 z-10">
        ${this._renderDots(0)}
      </div>
    `;
  },

  _renderDots(activeIndex) {
    return Array.from({ length: this._totalCards }, (_, i) =>
      `<button data-wrapup-dot="${i}" class="w-2.5 h-2.5 rounded-full transition-all ${i === activeIndex ? 'bg-oura-accent scale-110' : 'bg-oura-muted/30'}" aria-label="Card ${i + 1}"></button>`
    ).join('');
  },

  // ── Card Rendering ──

  _cardShell(content) {
    return `<div class="min-w-full h-full flex flex-col px-6 pt-12 pb-16 overflow-y-auto sm:max-w-md sm:mx-auto">${content}</div>`;
  },

  _renderCard1() {
    const c = this._data?.challenge;
    if (!c) return this._cardShell('<p class="text-oura-muted">No challenge data</p>');

    const name = escapeHtml(c.name || 'Challenge');
    const protocolName = escapeHtml(c.protocol?.name || '');
    const start = this._formatDate(c.start_date);
    const end = this._formatDate(c.end_date);
    const myData = this._data.myData;
    const nightsTracked = myData?.challengeData?.length || 0;
    const participants = c.participants?.filter(p => p.status === 'accepted').length || 1;

    return this._cardShell(`
      <div class="flex-1 flex flex-col justify-center items-center text-center">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border border-purple-500/30 text-purple-400 mb-6">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Challenge Complete
        </div>
        <h1 class="text-3xl font-bold text-white mb-2">${name}</h1>
        ${protocolName ? `<p class="text-oura-muted text-base mb-6">${protocolName}</p>` : '<div class="mb-6"></div>'}
        <p class="text-oura-muted text-sm mb-2">${start} - ${end}</p>
        <div class="flex items-center gap-4 mt-2">
          <span class="text-sm text-oura-muted">${nightsTracked} nights tracked</span>
          <span class="w-1 h-1 rounded-full bg-oura-border"></span>
          <span class="text-sm text-oura-muted">${participants} ${participants === 1 ? 'participant' : 'participants'}</span>
        </div>
      </div>
      <div class="text-center pb-2">
        <p class="text-oura-accent text-base font-medium">Swipe to view your results</p>
        <p class="text-oura-muted text-xs mt-1">Personalized data and AI-powered insights</p>
      </div>
    `);
  },

  _renderCard2() {
    const myData = this._data?.myData;
    const improvements = this._data?.improvements;
    if (!myData || !improvements) return this._cardShell('<p class="text-oura-muted">No data available</p>');

    const baseline = myData.baselineData || [];
    const challenge = myData.challengeData || [];

    // Compute averages
    const avg = (arr, key) => {
      const vals = arr.filter(d => d[key] != null).map(d => d[key]);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };

    const baseScore = avg(baseline, 'sleep_score');
    const currScore = avg(challenge, 'sleep_score');
    const baseDeep = avg(baseline, 'deep_sleep_minutes');
    const currDeep = avg(challenge, 'deep_sleep_minutes');
    const baseHR = avg(baseline, 'avg_hr');
    const currHR = avg(challenge, 'avg_hr');
    const baseBedtime = this._avgBedtime(baseline);
    const currBedtime = this._avgBedtime(challenge);

    // Bedtime difference in minutes
    let bedtimeDiff = null;
    if (baseBedtime && currBedtime) {
      const toMin = (t) => { const [h, m] = t.split(':').map(Number); return (h < 12 ? h + 24 : h) * 60 + m; };
      bedtimeDiff = toMin(currBedtime) - toMin(baseBedtime);
    }

    const metrics = [
      { label: 'Sleep Score', before: baseScore, after: currScore, unit: ' pts', lowerBetter: false },
      { label: 'Deep Sleep', before: baseDeep, after: currDeep, unit: ' min', lowerBetter: false },
      { label: 'Resting HR', before: baseHR, after: currHR, unit: ' bpm', lowerBetter: true },
      { label: 'Avg Bedtime', before: baseBedtime, after: currBedtime, unit: '', lowerBetter: false, isBedtime: true, bedtimeDiff }
    ];

    return this._cardShell(`
      <div class="flex-1 flex flex-col justify-center">
        <h2 class="text-2xl font-bold text-white text-center mb-2">Your Numbers</h2>
        <p class="text-oura-muted text-sm text-center mb-8">Baseline vs. challenge averages</p>
        <div class="space-y-3">
          ${metrics.map(m => this._renderMetricRow(m)).join('')}
        </div>
      </div>
    `);
  },

  _renderMetricRow({ label, before, after, unit, lowerBetter, isBedtime, bedtimeDiff }) {
    const bStr = isBedtime ? (before || '--') : (before != null ? before + unit : '--');
    const aStr = isBedtime ? (after || '--') : (after != null ? after + unit : '--');

    let changeStr = '';
    let changeColor = 'text-oura-muted';

    if (isBedtime && bedtimeDiff != null) {
      const absDiff = Math.abs(bedtimeDiff);
      changeStr = bedtimeDiff === 0 ? 'No change' : (bedtimeDiff > 0 ? '+' : '-') + absDiff + ' min';
      // Earlier bedtime (negative diff) is generally better but just show neutral
      changeColor = bedtimeDiff < 0 ? 'text-emerald-400' : bedtimeDiff > 0 ? 'text-red-400' : 'text-oura-muted';
    } else if (before != null && after != null && !isBedtime && before !== 0) {
      const pct = Math.round(((after - before) / before) * 100);
      const improved = lowerBetter ? pct < 0 : pct > 0;
      const declined = lowerBetter ? pct > 0 : pct < 0;
      const displayPct = lowerBetter ? -pct : pct;
      changeStr = (displayPct > 0 ? '+' : '') + displayPct + '%';
      changeColor = improved ? 'text-emerald-400' : declined ? 'text-red-400' : 'text-oura-muted';
    }

    return `
      <div class="bg-oura-card rounded-2xl p-5 border border-oura-border/30">
        <div class="flex items-center justify-between mb-3">
          <p class="text-xs text-oura-muted uppercase tracking-wider font-medium">${label}</p>
          <span class="text-xl font-bold ${changeColor}">${changeStr || '--'}</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex-1">
            <p class="text-xs text-oura-muted mb-1">Before</p>
            <p class="text-lg text-oura-muted font-medium">${bStr}</p>
          </div>
          <svg class="w-5 h-5 text-oura-border flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"/></svg>
          <div class="flex-1 text-right">
            <p class="text-xs text-oura-muted mb-1">After</p>
            <p class="text-lg text-white font-bold">${aStr}</p>
          </div>
        </div>
      </div>
    `;
  },

  _renderCard3() {
    if (this._aiContent?.highlights) {
      return this._cardShell(`
        <div class="flex-1 flex flex-col justify-center">
          <h2 class="text-2xl font-bold text-white text-center mb-2">Your Highlights</h2>
          <p class="text-oura-muted text-sm text-center mb-8">Key findings from your challenge</p>
          <div class="space-y-3">
            ${this._aiContent.highlights.map((h, i) => `
              <div class="bg-oura-card rounded-2xl p-5 border border-oura-border/30">
                <div class="flex items-start gap-3">
                  <span class="text-oura-accent font-bold text-xl mt-0.5">${i + 1}</span>
                  <div>
                    <p class="font-semibold text-white text-base mb-1">${escapeHtml(h.title)}</p>
                    <p class="text-white/80 text-sm leading-relaxed">${escapeHtml(h.body)}</p>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }

    return this._cardShell(`
      <div class="flex-1 flex flex-col justify-center">
        <h2 class="text-2xl font-bold text-white text-center mb-2">Your Highlights</h2>
        <p class="text-oura-muted text-sm text-center mb-8">Key findings from your challenge</p>
        <div id="wrapup-card3-content" class="space-y-3">
          ${this._renderSkeletonCards(3)}
        </div>
      </div>
    `);
  },

  _renderCard4() {
    if (this._aiContent?.routine) {
      return this._cardShell(`
        <div class="flex-1 flex flex-col justify-center">
          <h2 class="text-2xl font-bold text-white text-center mb-2">Your Routine</h2>
          <p class="text-oura-muted text-sm text-center mb-8">Personalized for your sleep patterns</p>
          <div class="space-y-3">
            ${this._aiContent.routine.map((step, i) => `
              <div class="bg-oura-card rounded-2xl p-5 border border-oura-border/30">
                <div class="flex items-start gap-3">
                  <span class="text-oura-accent font-bold text-xl mt-0.5">${i + 1}</span>
                  <p class="text-white text-sm leading-relaxed">${escapeHtml(step)}</p>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }

    return this._cardShell(`
      <div class="flex-1 flex flex-col justify-center">
        <h2 class="text-2xl font-bold text-white text-center mb-2">Your Routine</h2>
        <p class="text-oura-muted text-sm text-center mb-8">Personalized for your sleep patterns</p>
        <div id="wrapup-card4-content" class="space-y-3">
          ${this._renderSkeletonCards(4)}
        </div>
      </div>
    `);
  },

  _renderCard5() {
    const hasTakeaways = this._aiContent?.takeaways?.length > 0;

    return this._cardShell(`
      <div class="flex-1 flex flex-col justify-center">
        <h2 class="text-2xl font-bold text-white text-center mb-2">What's Next</h2>
        <p class="text-oura-muted text-sm text-center mb-8">Keep the momentum going</p>
        ${hasTakeaways ? `
          <div class="space-y-3 mb-8">
            ${this._aiContent.takeaways.map((t, i) => `
              <div class="bg-oura-card rounded-2xl p-5 border border-oura-border/30">
                <div class="flex items-start gap-3">
                  <span class="text-oura-accent font-bold text-xl mt-0.5">${i + 1}</span>
                  <p class="text-white text-sm leading-relaxed">${escapeHtml(t)}</p>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div id="wrapup-card5-content" class="mb-8">
            ${this._renderSkeletonCards(3)}
          </div>
        `}
        <button onclick="Wrapup.dismiss(); App.navigateTo('challenges')"
          class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl text-base">
          Start a New Challenge
        </button>
        <button onclick="Wrapup.dismiss()" class="w-full py-3 text-oura-muted text-sm mt-1">
          Close
        </button>
      </div>
    `);
  },

  // ── Skeleton Loading ──

  _renderSkeletonCards(n) {
    return Array.from({ length: n }, () => `
      <div class="bg-oura-card rounded-xl p-4 border border-oura-border/30">
        <div class="skeleton-bar h-3 w-32 mb-2"></div>
        <div class="skeleton-bar h-3 w-full"></div>
      </div>
    `).join('');
  },

  _renderSkeletonLines(n) {
    return Array.from({ length: n }, (_, i) => `
      <div class="skeleton-bar h-3 ${i === n - 1 ? 'w-2/3' : 'w-full'} mb-3"></div>
    `).join('');
  },

  // ── Swipe Handling (adapted from league carousel) ──

  _attachSwipe(wrapper) {
    const track = wrapper.querySelector('#wrapup-track');
    const clip = wrapper.querySelector('#wrapup-clip');
    if (!track || !clip) return;

    let startX = 0, startY = 0, isDragging = false;
    let directionLocked = false, isHorizontal = false;

    const getSlideWidth = () => clip.clientWidth;

    clip.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = true;
      directionLocked = false;
      isHorizontal = false;
      track.style.transition = 'none';
    }, { passive: true });

    clip.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (!directionLocked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        directionLocked = true;
        isHorizontal = Math.abs(dx) >= Math.abs(dy);
      }
      if (!directionLocked || !isHorizontal) return;

      const slideW = getSlideWidth();
      const baseOffset = -this._currentIndex * slideW;
      let offset = baseOffset + dx;

      // Rubber-band at edges
      if (this._currentIndex === 0 && dx > 0) {
        offset = baseOffset + dx * 0.3;
      } else if (this._currentIndex === this._totalCards - 1 && dx < 0) {
        offset = baseOffset + dx * 0.3;
      }

      track.style.transform = `translateX(${offset}px)`;
    }, { passive: true });

    clip.addEventListener('touchend', (e) => {
      if (!isDragging) return;
      isDragging = false;

      // If direction was never locked (< 8px movement), it's a tap.
      // Don't call _goToCard — the DOM changes prevent iOS from
      // synthesizing the click event on buttons underneath.
      if (!directionLocked) {
        track.style.transition = '';
        return;
      }

      if (!isHorizontal) {
        this._goToCard(this._currentIndex);
        return;
      }

      const dx = e.changedTouches[0].clientX - startX;
      const slideW = getSlideWidth();
      const threshold = slideW * 0.2;
      let target = this._currentIndex;

      if (Math.abs(dx) > threshold) {
        if (dx < 0 && target < this._totalCards - 1) target++;
        else if (dx > 0 && target > 0) target--;
      }

      this._goToCard(target);
    }, { passive: true });
  },

  _goToCard(index) {
    this._currentIndex = index;
    const track = document.getElementById('wrapup-track');
    const clip = document.getElementById('wrapup-clip');
    if (!track || !clip) return;

    const slideW = clip.clientWidth;
    track.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
    track.style.transform = `translateX(${-index * slideW}px)`;

    // Update dots
    const dotsEl = document.getElementById('wrapup-dots');
    if (dotsEl) dotsEl.innerHTML = this._renderDots(index);
  },

  _attachClicks(wrapper) {
    // Dot navigation
    wrapper.addEventListener('click', (e) => {
      const dot = e.target.closest('[data-wrapup-dot]');
      if (dot) {
        const idx = parseInt(dot.dataset.wrapupDot, 10);
        if (!isNaN(idx)) this._goToCard(idx);
      }
    });
  },

  // ── AI Integration ──

  async _fetchAi() {
    if (this._aiFetchInFlight) return;
    this._aiFetchInFlight = true;

    try {
      // Fetch user's chat notes (travel, jet lag, alcohol, etc.) for richer context
      const challengeId = this._data.challenge?.id;
      if (challengeId) {
        try {
          if (typeof Dashboard !== 'undefined' && Dashboard._fetchChatContext) {
            const chatCtx = await Dashboard._fetchChatContext(challengeId);
            if (chatCtx) this._data.chatContext = chatCtx;
          }
        } catch (chatErr) { console.warn('[Wrapup] Chat context fetch failed:', chatErr.message); }
      }

      const context = this._buildWrapupContext();
      const resp = await fetch('/api/ai/wrapup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sleepContext: context })
      });

      if (!resp.ok) throw new Error('AI request failed');
      const { wrapup } = await resp.json();
      if (!wrapup) throw new Error('Empty response');

      this._aiContent = this._parseAiResponse(wrapup);

      // Cache permanently per challenge
      const cacheKey = 'wrapup_ai_' + (this._data.challenge?.id || 'unknown');
      try { localStorage.setItem(cacheKey, JSON.stringify(this._aiContent)); } catch { /* full */ }

      // Re-render AI cards
      this._updateAiCards();
    } catch (err) {
      console.warn('[Wrapup] AI fetch failed:', err.message);
      this._renderAiError();
    } finally {
      this._aiFetchInFlight = false;
    }
  },

  _buildWrapupContext() {
    const d = this._data;
    const c = d.challenge;
    const myData = d.myData;
    const baseline = myData?.baselineData || [];
    const challenge = myData?.challengeData || [];

    const avg = (arr, key) => {
      const vals = arr.filter(r => r[key] != null).map(r => r[key]);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };

    let ctx = `CHALLENGE: "${c.name}" (${c.start_date} to ${c.end_date}, 30 days)\n\n`;

    // Baseline summary (just averages — the detail matters for the challenge period)
    ctx += `BASELINE (${baseline.length} nights before challenge):\n`;
    ctx += `Avg score: ${avg(baseline, 'sleep_score') ?? 'N/A'}, Avg deep: ${avg(baseline, 'deep_sleep_minutes') ?? 'N/A'} min, Avg HR: ${avg(baseline, 'avg_hr') ?? 'N/A'}, Avg bedtime: ${this._avgBedtime(baseline) || 'N/A'}\n\n`;

    // Night-by-night challenge data — the AI needs this to find patterns
    ctx += `CHALLENGE NIGHTS (${challenge.length} nights, chronological):\n`;
    const sorted = [...challenge].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach(n => {
      const bt = this._formatBedtime(n.bedtime_start) || '?';
      const dow = new Date(n.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      ctx += `${n.date} (${dow}): score=${n.sleep_score ?? '?'}, deep=${n.deep_sleep_minutes ?? '?'}min, HR=${n.avg_hr ?? '?'}, bedtime=${bt}\n`;
    });

    // Pre-computed patterns to help the AI
    ctx += '\nPATTERN ANALYSIS:\n';

    // Week-by-week breakdown
    if (sorted.length >= 14) {
      const weeks = [];
      for (let i = 0; i < sorted.length; i += 7) {
        const week = sorted.slice(i, i + 7);
        const wAvg = avg(week, 'sleep_score');
        const wDeep = avg(week, 'deep_sleep_minutes');
        if (wAvg != null) weeks.push({ num: weeks.length + 1, avg: wAvg, deep: wDeep, count: week.length });
      }
      if (weeks.length >= 2) {
        ctx += 'Week-by-week scores: ' + weeks.map(w => `Week ${w.num}: ${w.avg} avg (${w.count} nights)`).join(', ') + '\n';
      }
    }

    // Outlier detection — nights 15+ points below the user's median
    const scores = sorted.filter(n => n.sleep_score != null).map(n => n.sleep_score);
    if (scores.length >= 5) {
      const sortedScores = [...scores].sort((a, b) => a - b);
      const median = sortedScores[Math.floor(sortedScores.length / 2)];
      const outliers = sorted.filter(n => n.sleep_score != null && n.sleep_score < median - 15);
      if (outliers.length > 0 && outliers.length <= sorted.length / 3) {
        const withoutOutliers = sorted.filter(n => n.sleep_score != null && n.sleep_score >= median - 15);
        const cleanAvg = avg(withoutOutliers, 'sleep_score');
        const fullAvg = avg(sorted, 'sleep_score');
        ctx += `Outlier nights (15+ pts below median ${median}): ${outliers.map(n => n.date + '=' + n.sleep_score).join(', ')}\n`;
        ctx += `Overall avg: ${fullAvg}. Excluding outliers: ${cleanAvg} (${outliers.length} nights removed)\n`;
      }
    }

    // Bedtime buckets
    const withBedtime = sorted.filter(n => n.bedtime_start && n.sleep_score != null);
    if (withBedtime.length >= 5) {
      const buckets = { 'before 22:30': [], '22:30-23:00': [], '23:00-23:30': [], '23:30-00:00': [], 'after midnight': [] };
      withBedtime.forEach(n => {
        const h = this._bedtimeHour(n.bedtime_start);
        const m = parseInt((this._formatBedtime(n.bedtime_start) || '00:00').split(':')[1], 10);
        const totalMin = (h < 12 ? h + 24 : h) * 60 + m;
        if (totalMin < 22 * 60 + 30) buckets['before 22:30'].push(n);
        else if (totalMin < 23 * 60) buckets['22:30-23:00'].push(n);
        else if (totalMin < 23 * 60 + 30) buckets['23:00-23:30'].push(n);
        else if (totalMin < 24 * 60) buckets['23:30-00:00'].push(n);
        else buckets['after midnight'].push(n);
      });
      ctx += 'Bedtime buckets:\n';
      Object.entries(buckets).forEach(([label, nights]) => {
        if (nights.length > 0) {
          ctx += `  ${label}: ${nights.length} nights, avg score ${avg(nights, 'sleep_score')}, avg deep ${avg(nights, 'deep_sleep_minutes')} min\n`;
        }
      });
    }

    // Weekend vs weekday
    const weekdays = sorted.filter(n => {
      const dow = new Date(n.date + 'T12:00:00').getDay();
      return dow >= 1 && dow <= 5 && n.sleep_score != null;
    });
    const weekends = sorted.filter(n => {
      const dow = new Date(n.date + 'T12:00:00').getDay();
      return (dow === 0 || dow === 6) && n.sleep_score != null;
    });
    if (weekdays.length >= 3 && weekends.length >= 2) {
      ctx += `Weekday avg: ${avg(weekdays, 'sleep_score')} (${weekdays.length} nights), Weekend avg: ${avg(weekends, 'sleep_score')} (${weekends.length} nights)\n`;
    }

    // Habit completions
    if (d.habitProgress?.length > 0) {
      ctx += '\nHABIT COMPLETIONS:\n';
      d.habitProgress.forEach(h => {
        ctx += `- "${h.title}": completed ${h.completedDays ?? '?'}/${h.totalDays ?? 30} days\n`;
      });
    }

    // Chat context (travel, jet lag, alcohol, stress notes)
    if (d.chatContext) {
      ctx += '\nUSER CONTEXT (notes from during the challenge):\n' + d.chatContext + '\n';
    }

    return ctx;
  },

  _parseAiResponse(text) {
    const sections = { highlights: [], routine: [], takeaways: [] };

    // Split by ## headings
    const highlightsMatch = text.match(/## Highlights\s*\n([\s\S]*?)(?=## Routine|$)/i);
    const routineMatch = text.match(/## Routine\s*\n([\s\S]*?)(?=## Takeaways|$)/i);
    const takeawaysMatch = text.match(/## Takeaways\s*\n([\s\S]*?)$/i);

    if (highlightsMatch) {
      // Parse highlights: **Title** followed by body text
      const raw = highlightsMatch[1].trim();
      const blocks = raw.split(/\n\*\*/).filter(Boolean);
      blocks.forEach(block => {
        // First block may start with ** already stripped or not
        const cleaned = block.startsWith('**') ? block.slice(2) : block;
        const titleEnd = cleaned.indexOf('**');
        if (titleEnd > 0) {
          const title = cleaned.slice(0, titleEnd).trim();
          const body = cleaned.slice(titleEnd + 2).replace(/^\n/, '').trim();
          sections.highlights.push({ title, body });
        } else {
          // Fallback: first line is title, rest is body
          const lines = cleaned.split('\n').filter(l => l.trim());
          if (lines.length >= 1) {
            sections.highlights.push({
              title: lines[0].replace(/\*\*/g, '').trim(),
              body: lines.slice(1).join(' ').trim()
            });
          }
        }
      });
    }

    if (routineMatch) {
      // Parse numbered steps
      const lines = routineMatch[1].trim().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        const cleaned = line.replace(/^\d+[\.\)]\s*/, '').trim();
        if (cleaned) sections.routine.push(cleaned);
      });
    }

    if (takeawaysMatch) {
      // Parse bullet points
      const lines = takeawaysMatch[1].trim().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        const cleaned = line.replace(/^[-*]\s*/, '').trim();
        if (cleaned) sections.takeaways.push(cleaned);
      });
    }

    return sections;
  },

  _updateAiCards() {
    const overlay = document.getElementById('wrapup-overlay');
    if (!overlay || !this._aiContent) return;

    // Re-render the track with AI content now available
    const track = document.getElementById('wrapup-track');
    if (!track) return;

    // Preserve current position
    const clip = document.getElementById('wrapup-clip');
    const slideW = clip ? clip.clientWidth : 0;

    track.innerHTML = `
      ${this._renderCard1()}
      ${this._renderCard2()}
      ${this._renderCard3()}
      ${this._renderCard4()}
      ${this._renderCard5()}
    `;

    // Restore position without animation
    track.style.transition = 'none';
    track.style.transform = `translateX(${-this._currentIndex * slideW}px)`;
  },

  _renderAiError() {
    const targets = [
      { id: 'wrapup-card3-content', html: '<p class="text-oura-muted text-sm text-center">Could not load your highlights.</p><button onclick="Wrapup._retryAi()" class="text-oura-accent text-sm mt-2 mx-auto block">Try again</button>' },
      { id: 'wrapup-card4-content', html: '<p class="text-oura-muted text-sm text-center">Review your challenge data to find what worked for you.</p>' },
      { id: 'wrapup-card5-content', html: '' }
    ];
    targets.forEach(({ id, html }) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  },

  _retryAi() {
    // Reset skeleton loading on card 3
    const el = document.getElementById('wrapup-card3-content');
    if (el) el.innerHTML = this._renderSkeletonCards(3);
    const el4 = document.getElementById('wrapup-card4-content');
    if (el4) el4.innerHTML = this._renderSkeletonLines(4);
    const el5 = document.getElementById('wrapup-card5-content');
    if (el5) el5.innerHTML = this._renderSkeletonLines(3);
    this._fetchAi();
  },

  // ── Helpers ──

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  _formatBedtime(isoStr) {
    if (!isoStr) return null;
    try {
      const match = isoStr.match(/T(\d{2}:\d{2})/);
      return match ? match[1] : null;
    } catch { return null; }
  },

  _bedtimeHour(isoStr) {
    const bt = this._formatBedtime(isoStr);
    if (!bt) return null;
    return parseInt(bt.split(':')[0], 10);
  },

  _avgBedtime(data) {
    const bedtimes = data.filter(d => d.bedtime_start).map(d => {
      const bt = this._formatBedtime(d.bedtime_start);
      if (!bt) return null;
      const [h, m] = bt.split(':').map(Number);
      // Normalize: hours < 12 means after midnight, shift to 24+ for averaging
      return h < 12 ? (h + 24) * 60 + m : h * 60 + m;
    }).filter(v => v !== null);

    if (bedtimes.length === 0) return null;

    const avgMin = Math.round(bedtimes.reduce((a, b) => a + b, 0) / bedtimes.length);
    const normH = Math.floor(avgMin / 60) % 24;
    const normM = avgMin % 60;
    return `${String(normH).padStart(2, '0')}:${String(normM).padStart(2, '0')}`;
  },

  // Dev preview: trigger wrap-up with mock data via ?_wrapup_preview=1
  _checkPreview() {
    if (!new URLSearchParams(window.location.search).has('_wrapup_preview')) return;
    // Clear the param
    history.replaceState(null, '', '/');
    const mk = (n, fn) => Array.from({ length: n }, fn);
    this.show({
      challenge: { id: 'preview', name: '30-Day Sleep Protocol', start_date: '2026-02-14', end_date: '2026-03-15', protocol: { name: 'Huberman Sleep Stack' }, participants: [{ status: 'accepted' }, { status: 'accepted' }, { status: 'accepted' }] },
      myData: {
        baselineData: mk(25, (_, i) => ({ sleep_score: 68 + (i % 10), deep_sleep_minutes: 55 + (i % 20), avg_hr: 59 + (i % 4), bedtime_start: '2026-01-' + String(15 + i).padStart(2, '0') + 'T23:' + String(30 + (i % 25)).padStart(2, '0') + ':00-06:00' })),
        challengeData: mk(28, (_, i) => ({ sleep_score: 75 + (i % 12), deep_sleep_minutes: 70 + (i % 30), avg_hr: 55 + (i % 4), bedtime_start: '2026-02-' + String(14 + i).padStart(2, '0') + 'T22:' + String(20 + (i % 30)).padStart(2, '0') + ':00-06:00' }))
      },
      improvements: { score: { pct: 8, direction: 'up' }, hr: { pct: -5, direction: 'up' }, avghr: { pct: -4, direction: 'up' }, deep: { pct: 18, direction: 'up' }, presleep: { pct: -3, direction: 'up' } },
      sleepData: [],
      habitProgress: [{ title: 'No screens 1hr before bed', completedDays: 22, totalDays: 28 }, { title: 'Magnesium before bed', completedDays: 25, totalDays: 28 }, { title: '10 min morning sunlight', completedDays: 15, totalDays: 28 }]
    });
  }
};
