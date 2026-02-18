// Performance Dashboard Module

const Dashboard = {
  // Chart instances for cleanup (prevent memory leaks)
  charts: {},

  // Render generation counter to prevent stale async callbacks from overwriting fresher renders
  _renderGeneration: 0,

  // Main render entry point
  async render() {
    const container = document.getElementById('dashboard-container');
    if (!container) return;

    const generation = ++this._renderGeneration;

    // Try to render instantly from cache (but always refresh in background)
    const cachedData = Cache.get('dashboard');
    if (cachedData) {
      this._renderContent(container, cachedData);
    } else {
      container.innerHTML = `
        <div class="text-center py-10 text-oura-muted text-sm">Loading dashboard...</div>
      `;
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

      // Cache the data
      Cache.set('dashboard', { profile, activeChallenges, recentSleep });

      // Re-render with fresh data
      this._renderContent(container, { profile, activeChallenges, recentSleep });

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
        Cache.set('dashboard', { profile, activeChallenges, recentSleep });
        const container = document.getElementById('dashboard-container');
        if (container) this._renderContent(container, { profile, activeChallenges, recentSleep });
      }
    } catch (e) {
      console.warn('[Dashboard] Background sync failed:', e);
    }
  },

  // Render dashboard content (separated for caching)
  _renderContent(container, { profile, activeChallenges, recentSleep }) {
    try {

      const avgPreSleepHR = this.calcAvgPreSleepHR(recentSleep);
      const avgHR = this.calcAvgHR(recentSleep);
      const avgDeepSleep = this.calcAvgDeepSleep(recentSleep);
      const avgSleepScore = this.calcAvgSleepScore(recentSleep);
      // Chronological order for sparklines
      const chronologicalSleep = [...recentSleep].sort((a, b) => a.date.localeCompare(b.date));

      let html = '';

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

      // 30-Day Baseline — 4 full-width metric bars stacked vertically
      html += `
        <div class="bg-oura-card rounded-2xl p-5 mb-4">
          <div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-4">Your 30-Day Baseline</div>
          <div class="space-y-3">
            <div class="bg-oura-subtle rounded-xl p-3 cursor-pointer hover:bg-oura-border/50 transition-colors flex items-center gap-4" onclick="Dashboard.showMetricDetail('sleep_score')">
              <div class="flex-shrink-0">
                <div class="text-[0.6rem] font-semibold text-purple-400 uppercase tracking-wider mb-1">Sleep Score</div>
                <div class="text-xl font-bold text-purple-400 leading-none">${avgSleepScore !== null ? avgSleepScore : '--'} <span class="text-[0.55rem] font-normal text-oura-muted">pts</span></div>
              </div>
              <div class="flex-1 h-10 overflow-hidden"><canvas id="sparkline-sleep-score"></canvas></div>
            </div>
            <div class="bg-oura-subtle rounded-xl p-3 cursor-pointer hover:bg-oura-border/50 transition-colors flex items-center gap-4" onclick="Dashboard.showMetricDetail('avg_hr')">
              <div class="flex-shrink-0">
                <div class="text-[0.6rem] font-semibold text-orange-400 uppercase tracking-wider mb-1">Avg HR</div>
                <div class="text-xl font-bold text-orange-400 leading-none">${avgHR !== null ? avgHR : '--'} <span class="text-[0.55rem] font-normal text-oura-muted">bpm</span></div>
              </div>
              <div class="flex-1 h-10 overflow-hidden"><canvas id="sparkline-avg-hr"></canvas></div>
            </div>
            <div class="bg-oura-subtle rounded-xl p-3 cursor-pointer hover:bg-oura-border/50 transition-colors flex items-center gap-4" onclick="Dashboard.showMetricDetail('pre_sleep_hr')">
              <div class="flex-shrink-0">
                <div class="text-[0.6rem] font-semibold text-teal-400 uppercase tracking-wider mb-1">Lowest HR</div>
                <div class="text-xl font-bold text-teal-400 leading-none">${avgPreSleepHR !== null ? avgPreSleepHR : '--'} <span class="text-[0.55rem] font-normal text-oura-muted">bpm</span></div>
              </div>
              <div class="flex-1 h-10 overflow-hidden"><canvas id="sparkline-presleep-hr"></canvas></div>
            </div>
            <div class="bg-oura-subtle rounded-xl p-3 cursor-pointer hover:bg-oura-border/50 transition-colors flex items-center gap-4" onclick="Dashboard.showMetricDetail('deep_sleep')">
              <div class="flex-shrink-0">
                <div class="text-[0.6rem] font-semibold text-blue-400 uppercase tracking-wider mb-1">Deep Sleep</div>
                <div class="text-xl font-bold text-blue-400 leading-none">${avgDeepSleep !== null ? avgDeepSleep : '--'} <span class="text-[0.55rem] font-normal text-oura-muted">min</span></div>
              </div>
              <div class="flex-1 h-10 overflow-hidden"><canvas id="sparkline-deep-sleep"></canvas></div>
            </div>
          </div>
        </div>
      `;

      // Active challenge cards
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

      container.innerHTML = html;

      // Initialize sparklines after DOM is ready
      this.renderSparkline('sparkline-sleep-score', chronologicalSleep.map(d => d.sleep_score), '#c084fc');
      this.renderSparkline('sparkline-avg-hr', chronologicalSleep.map(d => d.avg_hr), '#fb923c');
      this.renderSparkline('sparkline-presleep-hr', chronologicalSleep.map(d => d.pre_sleep_hr), '#2dd4bf');
      this.renderSparkline('sparkline-deep-sleep', chronologicalSleep.map(d => d.deep_sleep_minutes), '#60a5fa');
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
  }
};

// Export for use in other modules
window.Dashboard = Dashboard;
