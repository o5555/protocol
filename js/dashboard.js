// Performance Dashboard Module

const Dashboard = {
  // Main render entry point
  async render() {
    const container = document.getElementById('dashboard-container');
    if (!container) return;

    container.innerHTML = `
      <div class="text-center py-10 text-oura-muted text-sm">Loading dashboard...</div>
    `;

    try {
      const [profile, activeChallenges, friends, recentSleep] = await Promise.all([
        Auth.getProfile(),
        Challenges.getActiveChallenges().catch(() => []),
        Friends.getFriends().catch(() => []),
        this.getRecentSleepData().catch(() => [])
      ]);

      const avgHR = this.calcAvgHR(recentSleep);
      const avgPreSleepHR = this.calcAvgPreSleepHR(recentSleep);
      const avgDeepSleep = this.calcAvgDeepSleep(recentSleep);
      const avgSleepScore = this.calcAvgSleepScore(recentSleep);
      const challenge = activeChallenges[0] || null;
      const message = this.getMotivationalMessage(avgHR, challenge);

      // Chronological order for sparklines
      const chronologicalSleep = [...recentSleep].sort((a, b) => a.date.localeCompare(b.date));

      let html = '';

      // No-token prompt
      if (!profile?.oura_token) {
        html += `
          <div class="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 mb-4">
            <div class="flex items-start gap-3">
              <span class="text-2xl">&#x1F48D;</span>
              <div>
                <p class="font-semibold text-amber-400 mb-1">Connect Your Oura Ring</p>
                <p class="text-sm text-oura-muted">Link your Oura ring to see heart rate data and sleep insights.</p>
                <button onclick="App.showSettings()" class="mt-3 px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-500/30 transition-colors">
                  Open Settings
                </button>
              </div>
            </div>
          </div>
        `;
      }

      // Pre-Sleep HR card
      html += `
        <div class="bg-oura-card rounded-2xl p-6 mb-4">
          <div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-4">7-Day Avg Heart Rate</div>
          <div class="text-center py-4">
            <span class="text-5xl font-bold text-oura-accent leading-none tracking-tight">${avgHR !== null ? avgHR : '--'}</span>
            <span class="text-2xl font-normal text-oura-accent ml-1">bpm</span>
            <div class="text-sm text-oura-muted mt-2 font-medium">Pre-Sleep Average</div>
          </div>
          ${recentSleep.length > 0 ? `
            <div class="flex justify-center gap-8 pt-4 border-t border-oura-border mt-4">
              <div class="text-center">
                <div class="text-xl font-semibold text-white">${this.getMinHR(recentSleep)}</div>
                <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Lowest</div>
              </div>
              <div class="text-center">
                <div class="text-xl font-semibold text-white">${this.getMaxHR(recentSleep)}</div>
                <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Highest</div>
              </div>
              <div class="text-center">
                <div class="text-xl font-semibold text-white">${recentSleep.length}</div>
                <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Nights</div>
              </div>
            </div>
          ` : ''}
        </div>
      `;

      // Metric sparkline cards row
      html += `
        <div class="grid grid-cols-3 gap-3 mb-4">
          <div class="bg-oura-card rounded-2xl p-4">
            <div class="text-[0.65rem] font-semibold text-teal-400 uppercase tracking-wider mb-2">Pre-Sleep HR</div>
            <div class="text-2xl font-bold text-teal-400 leading-none">${avgPreSleepHR !== null ? avgPreSleepHR : '--'}</div>
            <div class="text-[0.6rem] text-oura-muted mt-0.5">bpm avg</div>
            <div class="mt-2 h-10"><canvas id="sparkline-presleep-hr"></canvas></div>
          </div>
          <div class="bg-oura-card rounded-2xl p-4">
            <div class="text-[0.65rem] font-semibold text-blue-400 uppercase tracking-wider mb-2">Deep Sleep</div>
            <div class="text-2xl font-bold text-blue-400 leading-none">${avgDeepSleep !== null ? avgDeepSleep : '--'}</div>
            <div class="text-[0.6rem] text-oura-muted mt-0.5">min avg</div>
            <div class="mt-2 h-10"><canvas id="sparkline-deep-sleep"></canvas></div>
          </div>
          <div class="bg-oura-card rounded-2xl p-4">
            <div class="text-[0.65rem] font-semibold text-purple-400 uppercase tracking-wider mb-2">Sleep Score</div>
            <div class="text-2xl font-bold text-purple-400 leading-none">${avgSleepScore !== null ? avgSleepScore : '--'}</div>
            <div class="text-[0.6rem] text-oura-muted mt-0.5">pts avg</div>
            <div class="mt-2 h-10"><canvas id="sparkline-sleep-score"></canvas></div>
          </div>
        </div>
      `;

      // Friend comparison card
      if (challenge && friends.length > 0) {
        html += await this.renderFriendComparison(challenge);
      }

      // Active challenge card
      if (challenge) {
        const dayNum = Challenges.getDayNumber(challenge.start_date);
        const progress = Math.min(100, Math.round((dayNum / 30) * 100));
        html += `
          <div onclick="App.navigateTo('challenge-detail', '${challenge.id}')"
            class="bg-oura-card rounded-2xl p-6 mb-4 cursor-pointer hover:bg-oura-subtle transition-colors">
            <div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-4">Active Challenge</div>
            <div class="flex items-center gap-4 mb-4">
              <span class="text-3xl">${challenge.protocol?.icon || '&#x1F3C6;'}</span>
              <div>
                <h3 class="font-semibold text-lg">${challenge.name}</h3>
                <p class="text-oura-muted text-sm">${challenge.protocol?.name || 'Protocol'}</p>
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
      } else {
        html += `
          <div class="bg-oura-card rounded-2xl p-6 mb-4">
            <div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-4">Challenge</div>
            <p class="text-oura-muted text-sm mb-4">No active challenge. Start one to track your progress!</p>
            <button onclick="App.navigateTo('challenges')"
              class="w-full py-3 bg-oura-border text-white font-medium rounded-xl hover:bg-oura-subtle transition-colors text-sm">
              Browse Challenges
            </button>
          </div>
        `;
      }

      // Motivational card
      html += `
        <div class="bg-gradient-to-br from-oura-card to-oura-subtle rounded-2xl p-6 mb-4">
          <div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-3">Daily Insight</div>
          <p class="text-sm leading-relaxed">${message}</p>
        </div>
      `;

      container.innerHTML = html;

      // Initialize sparklines after DOM is ready
      this.renderSparkline('sparkline-presleep-hr', chronologicalSleep.map(d => d.pre_sleep_hr), '#2dd4bf');
      this.renderSparkline('sparkline-deep-sleep', chronologicalSleep.map(d => d.deep_sleep_minutes), '#60a5fa');
      this.renderSparkline('sparkline-sleep-score', chronologicalSleep.map(d => d.sleep_score), '#c084fc');
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-2xl p-4">
          <p class="text-red-400">Failed to load dashboard: ${error.message}</p>
        </div>
      `;
    }
  },

  // Fetch last 7 days of sleep data for current user
  async getRecentSleepData() {
    const client = SupabaseClient.client;
    if (!client) return [];

    const user = await SupabaseClient.getCurrentUser();
    if (!user) return [];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startStr = sevenDaysAgo.toISOString().split('T')[0];

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

    return data || [];
  },

  // Calculate average HR from recent sleep data
  calcAvgHR(sleepData) {
    const hrs = sleepData.filter(d => d.avg_hr).map(d => d.avg_hr);
    if (hrs.length === 0) return null;
    return Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
  },

  calcAvgPreSleepHR(sleepData) {
    const vals = sleepData.filter(d => d.pre_sleep_hr).map(d => d.pre_sleep_hr);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  },

  calcAvgDeepSleep(sleepData) {
    const vals = sleepData.filter(d => d.deep_sleep_minutes).map(d => d.deep_sleep_minutes);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  },

  calcAvgSleepScore(sleepData) {
    const vals = sleepData.filter(d => d.sleep_score).map(d => d.sleep_score);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  },

  getMinHR(sleepData) {
    const hrs = sleepData.filter(d => d.avg_hr).map(d => d.avg_hr);
    return hrs.length > 0 ? Math.min(...hrs) : '--';
  },

  getMaxHR(sleepData) {
    const hrs = sleepData.filter(d => d.avg_hr).map(d => d.avg_hr);
    return hrs.length > 0 ? Math.max(...hrs) : '--';
  },

  // Render a sparkline mini chart into a canvas element
  renderSparkline(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const values = data.filter(v => v != null);
    if (values.length < 2) return;

    new Chart(canvas, {
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
      const sleepData = await Comparison.getChallengeSleepData(challenge.id);
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
                  <span class="text-sm text-oura-muted">${p.name}</span>
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
