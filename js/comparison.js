// Comparison Charts Module

const Comparison = {
  // Chart instances for cleanup
  charts: {},

  // Colors for participants
  colors: [
    '#00c8a0', // Oura teal
    '#3b82f6', // Blue
    '#f59e0b', // Amber
    '#ef4444', // Red
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#10b981', // Emerald
    '#6366f1', // Indigo
  ],

  // Get sleep data for challenge participants (includes 30-day baseline before start)
  async getChallengeSleepData(challengeId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const challenge = await Challenges.getChallenge(challengeId);
    const participants = challenge.participants.filter(p => p.status === 'accepted');

    // Calculate exact 30-day baseline period (day -30 to day -1 before challenge start)
    const challengeStart = Challenges.parseLocalDate(challenge.start_date);
    const baselineStart = new Date(challengeStart);
    baselineStart.setDate(baselineStart.getDate() - 30);
    const baselineStartStr = Challenges.toLocalDateStr(baselineStart);
    const baselineEndStr = Challenges.toLocalDateStr(new Date(challengeStart.getTime() - 86400000)); // day before start

    const sleepDataPromises = participants.map(async (participant) => {
      const { data, error } = await client
        .from('sleep_data')
        .select('*')
        .eq('user_id', participant.user.id)
        .gte('date', baselineStartStr)
        .lte('date', challenge.end_date)
        .order('date');

      if (error) {
        console.error('Error fetching sleep data:', error);
        return { user: participant.user, data: [], baselineData: [], challengeData: [], baselineDays: 30, challengeDays: 0 };
      }

      // Split data into baseline (exactly 30 days before) and challenge period
      const baselineData = data.filter(d => d.date >= baselineStartStr && d.date < challenge.start_date);
      const challengeData = data.filter(d => d.date >= challenge.start_date);

      // Calculate how many days are in the challenge so far
      const today = new Date();
      const endDate = Challenges.parseLocalDate(challenge.end_date);
      const effectiveEnd = today < endDate ? today : endDate;
      const challengeDays = Math.max(0, Math.floor((effectiveEnd - challengeStart) / 86400000) + 1);

      return {
        user: participant.user,
        data,
        baselineData,
        challengeData,
        baselineDays: 30,
        challengeDays
      };
    });

    const sleepData = await Promise.all(sleepDataPromises);
    return { challenge, sleepData };
  },

  // Calculate median of an array
  calcMedian(values) {
    if (!values || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },

  // Calculate averages for a dataset over a fixed number of days
  // Uses median to estimate missing days
  calcAverages(data, expectedDays = null) {
    if (!data || data.length === 0) return { hr: null, score: null, hours: null, dataPoints: 0 };

    const hrValues = data.filter(d => d.pre_sleep_hr).map(d => d.pre_sleep_hr);
    const scoreValues = data.filter(d => d.sleep_score).map(d => d.sleep_score);
    const sleepValues = data.filter(d => d.total_sleep_minutes).map(d => d.total_sleep_minutes);

    // If we have expected days and missing data, use median to fill gaps
    const hrMedian = this.calcMedian(hrValues);
    const scoreMedian = this.calcMedian(scoreValues);
    const sleepMedian = this.calcMedian(sleepValues);

    // Calculate averages - if expectedDays provided, use it for denominator with median fill
    let hrAvg = null, scoreAvg = null, hoursAvg = null;

    if (hrValues.length > 0) {
      if (expectedDays && hrValues.length < expectedDays) {
        // Fill missing days with median
        const total = hrValues.reduce((s, v) => s + v, 0) + (expectedDays - hrValues.length) * hrMedian;
        hrAvg = Math.round(total / expectedDays);
      } else {
        hrAvg = Math.round(hrValues.reduce((s, v) => s + v, 0) / hrValues.length);
      }
    }

    if (scoreValues.length > 0) {
      if (expectedDays && scoreValues.length < expectedDays) {
        const total = scoreValues.reduce((s, v) => s + v, 0) + (expectedDays - scoreValues.length) * scoreMedian;
        scoreAvg = Math.round(total / expectedDays);
      } else {
        scoreAvg = Math.round(scoreValues.reduce((s, v) => s + v, 0) / scoreValues.length);
      }
    }

    if (sleepValues.length > 0) {
      if (expectedDays && sleepValues.length < expectedDays) {
        const total = sleepValues.reduce((s, v) => s + v, 0) + (expectedDays - sleepValues.length) * sleepMedian;
        hoursAvg = (total / expectedDays / 60).toFixed(1);
      } else {
        hoursAvg = (sleepValues.reduce((s, v) => s + v, 0) / sleepValues.length / 60).toFixed(1);
      }
    }

    return {
      hr: hrAvg,
      score: scoreAvg,
      hours: hoursAvg,
      dataPoints: data.length
    };
  },

  // Format change indicator (arrow + delta)
  formatChange(baseline, current, lowerIsBetter = false) {
    if (baseline === null || current === null) return '';

    const delta = current - baseline;
    if (delta === 0) return '<span class="text-oura-muted text-[10px]">—</span>';

    const isImprovement = lowerIsBetter ? delta < 0 : delta > 0;
    const arrow = delta < 0 ? '↓' : '↑';
    const color = isImprovement ? 'text-green-400' : 'text-red-400';
    const sign = delta > 0 ? '+' : '';

    return `<span class="${color} text-[10px]">${arrow}${sign}${delta.toFixed(delta % 1 === 0 ? 0 : 1)}</span>`;
  },

  // Render comparison charts for a challenge
  async renderForChallenge(challengeId) {
    const container = document.getElementById('comparison-charts');
    if (!container) return;

    try {
      const { challenge, sleepData } = await this.getChallengeSleepData(challengeId);

      // Check if we have data
      const hasData = sleepData.some(p => p.data.length > 0);

      if (!hasData) {
        container.innerHTML = `
          <p class="text-oura-muted text-sm">No sleep data available yet. Data appears after your first night with Oura synced.</p>
          <button onclick="SleepSync.syncNow()"
            class="mt-4 w-full px-4 py-3 min-h-[44px] bg-oura-teal text-gray-900 rounded-lg text-sm font-medium hover:bg-oura-teal/90">
            Sync My Sleep Data
          </button>
        `;
        return;
      }

      // Clean up existing charts
      Object.values(this.charts).forEach(chart => chart.destroy());
      this.charts = {};

      // Build participant summary cards with baseline vs current comparison
      const summaryCards = sleepData.map((p, i) => {
        const color = this.colors[i % this.colors.length];
        const name = p.user.display_name || p.user.email.split('@')[0];
        const initial = name.charAt(0).toUpperCase();

        if (p.data.length === 0) {
          return `
            <div class="bg-oura-subtle rounded-xl p-4">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style="background: ${color}30; color: ${color}">${initial}</div>
                <span class="font-semibold text-sm">${name}</span>
              </div>
              <p class="text-oura-muted text-xs">No data yet</p>
            </div>
          `;
        }

        const baseline = this.calcAverages(p.baselineData, 30); // Always 30-day baseline
        const current = this.calcAverages(p.challengeData, p.challengeDays);
        const hasBaseline = p.baselineData && p.baselineData.length > 0;
        const hasCurrent = p.challengeData && p.challengeData.length > 0;

        // Use current if available, otherwise show baseline
        const displayHR = hasCurrent ? current.hr : baseline.hr;
        const displayScore = hasCurrent ? current.score : baseline.score;
        const displayHours = hasCurrent ? current.hours : baseline.hours;

        return `
          <div class="bg-oura-subtle rounded-xl p-4">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style="background: ${color}30; color: ${color}">${initial}</div>
              <div class="flex-1 min-w-0">
                <span class="font-semibold text-sm block truncate">${name}</span>
                ${hasBaseline && hasCurrent ? '<span class="text-[9px] text-oura-muted">vs 30-day baseline</span>' :
                  hasBaseline ? '<span class="text-[9px] text-oura-muted">baseline only</span>' : ''}
              </div>
            </div>
            <div class="grid grid-cols-3 gap-2 text-center">
              <div>
                <p class="text-lg font-bold" style="color: ${color}">${displayHR || '--'}</p>
                <p class="text-[10px] text-oura-muted">HR</p>
                ${hasBaseline && hasCurrent ? this.formatChange(baseline.hr, current.hr, true) : ''}
              </div>
              <div>
                <p class="text-lg font-bold" style="color: ${color}">${displayScore || '--'}</p>
                <p class="text-[10px] text-oura-muted">Score</p>
                ${hasBaseline && hasCurrent ? this.formatChange(baseline.score, current.score, false) : ''}
              </div>
              <div>
                <p class="text-lg font-bold" style="color: ${color}">${displayHours || '--'}</p>
                <p class="text-[10px] text-oura-muted">Hours</p>
                ${hasBaseline && hasCurrent ? this.formatChange(parseFloat(baseline.hours), parseFloat(current.hours), false) : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Build baseline vs progress overview (aggregate across all participants with data)
      const allBaseline = sleepData.flatMap(p => p.baselineData || []);
      const allChallenge = sleepData.flatMap(p => p.challengeData || []);
      const totalBaselineDays = sleepData.reduce((sum, p) => sum + (p.baselineDays || 30), 0);
      const totalChallengeDays = sleepData.reduce((sum, p) => sum + (p.challengeDays || 0), 0);
      const groupBaseline = this.calcAverages(allBaseline, totalBaselineDays);
      const groupCurrent = this.calcAverages(allChallenge, totalChallengeDays);
      const hasGroupBaseline = allBaseline.length > 0;
      const hasGroupCurrent = allChallenge.length > 0;

      const progressOverview = (hasGroupBaseline || hasGroupCurrent) ? `
        <div class="bg-oura-card rounded-2xl p-5 mb-6">
          <h4 class="text-sm font-semibold mb-4">Progress Overview</h4>
          <div class="grid grid-cols-3 gap-4">
            <div class="text-center">
              <p class="text-[10px] text-oura-muted uppercase tracking-wide mb-1">Resting HR</p>
              ${hasGroupBaseline && hasGroupCurrent ? `
                <div class="flex items-center justify-center gap-2">
                  <span class="text-oura-muted text-sm">${groupBaseline.hr || '--'}</span>
                  <span class="text-oura-muted">→</span>
                  <span class="text-white text-lg font-bold">${groupCurrent.hr || '--'}</span>
                </div>
                <div class="mt-1">${this.formatChange(groupBaseline.hr, groupCurrent.hr, true)}</div>
              ` : `
                <p class="text-white text-lg font-bold">${hasGroupCurrent ? groupCurrent.hr : groupBaseline.hr || '--'}</p>
                <p class="text-[10px] text-oura-muted">${hasGroupCurrent ? 'current' : 'baseline'}</p>
              `}
            </div>
            <div class="text-center">
              <p class="text-[10px] text-oura-muted uppercase tracking-wide mb-1">Sleep Score</p>
              ${hasGroupBaseline && hasGroupCurrent ? `
                <div class="flex items-center justify-center gap-2">
                  <span class="text-oura-muted text-sm">${groupBaseline.score || '--'}</span>
                  <span class="text-oura-muted">→</span>
                  <span class="text-white text-lg font-bold">${groupCurrent.score || '--'}</span>
                </div>
                <div class="mt-1">${this.formatChange(groupBaseline.score, groupCurrent.score, false)}</div>
              ` : `
                <p class="text-white text-lg font-bold">${hasGroupCurrent ? groupCurrent.score : groupBaseline.score || '--'}</p>
                <p class="text-[10px] text-oura-muted">${hasGroupCurrent ? 'current' : 'baseline'}</p>
              `}
            </div>
            <div class="text-center">
              <p class="text-[10px] text-oura-muted uppercase tracking-wide mb-1">Sleep Hours</p>
              ${hasGroupBaseline && hasGroupCurrent ? `
                <div class="flex items-center justify-center gap-2">
                  <span class="text-oura-muted text-sm">${groupBaseline.hours || '--'}</span>
                  <span class="text-oura-muted">→</span>
                  <span class="text-white text-lg font-bold">${groupCurrent.hours || '--'}</span>
                </div>
                <div class="mt-1">${this.formatChange(parseFloat(groupBaseline.hours), parseFloat(groupCurrent.hours), false)}</div>
              ` : `
                <p class="text-white text-lg font-bold">${hasGroupCurrent ? groupCurrent.hours : groupBaseline.hours || '--'}</p>
                <p class="text-[10px] text-oura-muted">${hasGroupCurrent ? 'current' : 'baseline'}</p>
              `}
            </div>
          </div>
          ${hasGroupBaseline ? `
            <p class="text-[10px] text-oura-muted text-center mt-4">
              Baseline: ${allBaseline.length}/${totalBaselineDays} nights (30 days) · Challenge: ${allChallenge.length}/${totalChallengeDays} nights
            </p>
          ` : ''}
        </div>
      ` : '';

      container.innerHTML = `
        ${progressOverview}
        <div class="grid grid-cols-2 gap-3 mb-6">
          ${summaryCards}
        </div>
        <div class="space-y-6">
          <div>
            <h4 class="text-sm font-medium text-oura-muted mb-2">Pre-Sleep Heart Rate</h4>
            <canvas id="pre-sleep-hr-chart" height="200"></canvas>
          </div>
          <div>
            <h4 class="text-sm font-medium text-oura-muted mb-2">Sleep Score</h4>
            <canvas id="sleep-score-chart" height="200"></canvas>
          </div>
          <div>
            <h4 class="text-sm font-medium text-oura-muted mb-2">Avg Sleep Duration</h4>
            <canvas id="sleep-duration-chart" height="150"></canvas>
          </div>
        </div>
        <button onclick="SleepSync.syncNow()"
          class="mt-6 w-full px-4 py-3 min-h-[44px] bg-oura-subtle text-oura-muted rounded-xl text-sm font-medium hover:bg-oura-border transition-colors">
          Sync Sleep Data
        </button>
      `;

      // Create charts with challenge start date marker
      const startDate = challenge.start_date;
      this.createPreSleepHRChart(sleepData, startDate);
      this.createSleepScoreChart(sleepData, startDate);
      this.createSleepDurationChart(sleepData);
    } catch (error) {
      console.error('Error rendering comparison charts:', error);
      container.innerHTML = `
        <p class="text-red-400 text-sm">Failed to load comparison data: ${error.message}</p>
      `;
    }
  },

  // Create pre-sleep HR line chart
  createPreSleepHRChart(participantData, challengeStartDate) {
    const ctx = document.getElementById('pre-sleep-hr-chart');
    if (!ctx) return;

    // Get all unique dates
    const allDates = new Set();
    participantData.forEach(p => {
      p.data.forEach(d => allDates.add(d.date));
    });
    const dates = Array.from(allDates).sort();

    // Create datasets
    const datasets = participantData.map((p, i) => {
      const dataMap = new Map(p.data.map(d => [d.date, d.pre_sleep_hr]));
      return {
        label: p.user.display_name || p.user.email.split('@')[0],
        data: dates.map(date => dataMap.get(date) || null),
        borderColor: this.colors[i % this.colors.length],
        backgroundColor: this.colors[i % this.colors.length] + '20',
        tension: 0.3,
        spanGaps: true
      };
    });

    this.charts.preSleepHR = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates.map(d => this.formatDate(d, challengeStartDate)),
        datasets
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#9ca3af' }
          }
        },
        scales: {
          x: {
            ticks: { color: '#9ca3af', maxRotation: 45 },
            grid: { color: '#374151' }
          },
          y: {
            title: {
              display: true,
              text: 'BPM',
              color: '#9ca3af'
            },
            ticks: { color: '#9ca3af' },
            grid: { color: '#374151' }
          }
        }
      }
    });
  },

  // Create sleep score line chart
  createSleepScoreChart(participantData, challengeStartDate) {
    const ctx = document.getElementById('sleep-score-chart');
    if (!ctx) return;

    const allDates = new Set();
    participantData.forEach(p => {
      p.data.forEach(d => allDates.add(d.date));
    });
    const dates = Array.from(allDates).sort();

    const datasets = participantData.map((p, i) => {
      const dataMap = new Map(p.data.map(d => [d.date, d.sleep_score]));
      return {
        label: p.user.display_name || p.user.email.split('@')[0],
        data: dates.map(date => dataMap.get(date) || null),
        borderColor: this.colors[i % this.colors.length],
        backgroundColor: this.colors[i % this.colors.length] + '20',
        tension: 0.3,
        spanGaps: true
      };
    });

    this.charts.sleepScore = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates.map(d => this.formatDate(d, challengeStartDate)),
        datasets
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#9ca3af' }
          }
        },
        scales: {
          x: {
            ticks: { color: '#9ca3af', maxRotation: 45 },
            grid: { color: '#374151' }
          },
          y: {
            min: 0,
            max: 100,
            title: {
              display: true,
              text: 'Score',
              color: '#9ca3af'
            },
            ticks: { color: '#9ca3af' },
            grid: { color: '#374151' }
          }
        }
      }
    });
  },

  // Create average sleep duration bar chart
  createSleepDurationChart(participantData) {
    const ctx = document.getElementById('sleep-duration-chart');
    if (!ctx) return;

    const averages = participantData.map((p, i) => {
      if (p.data.length === 0) return { label: p.user.display_name || p.user.email.split('@')[0], value: 0 };

      const totalMinutes = p.data.reduce((sum, d) => sum + (d.total_sleep_minutes || 0), 0);
      const avgHours = (totalMinutes / p.data.length / 60).toFixed(1);

      return {
        label: p.user.display_name || p.user.email.split('@')[0],
        value: parseFloat(avgHours),
        color: this.colors[i % this.colors.length]
      };
    });

    this.charts.sleepDuration = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: averages.map(a => a.label),
        datasets: [{
          label: 'Avg Hours',
          data: averages.map(a => a.value),
          backgroundColor: averages.map(a => a.color),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            ticks: { color: '#9ca3af' },
            grid: { display: false }
          },
          y: {
            title: {
              display: true,
              text: 'Hours',
              color: '#9ca3af'
            },
            ticks: { color: '#9ca3af' },
            grid: { color: '#374151' }
          }
        }
      }
    });
  },

  // Format date for display, marking challenge start with arrow
  formatDate(dateStr, challengeStartDate) {
    const date = new Date(dateStr + 'T00:00:00');
    const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (dateStr === challengeStartDate) return '\u25B8 ' + label;
    return label;
  }
};

// Sleep data sync module
const SleepSync = {
  // Sync sleep data from Oura to Supabase
  // options.silent: suppress alerts and return result object instead
  async syncNow(options = {}) {
    const { silent = false, skipRefresh = false } = options;
    const client = SupabaseClient.client;
    if (!client) {
      if (silent) return { success: false, count: 0, error: 'Supabase not initialized' };
      throw new Error('Supabase not initialized');
    }

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) {
      if (silent) return { success: false, count: 0, error: 'Not authenticated' };
      throw new Error('Not authenticated');
    }

    // Get Oura token
    const profile = await Auth.getProfile();
    if (!profile?.oura_token) {
      if (!silent) alert('Please connect your Oura ring first in the Dashboard settings.');
      return { success: false, count: 0, error: 'No Oura token' };
    }

    try {
      // Fetch last 30 days of sleep data
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // Fetch from Oura API (sleep sessions + daily sleep scores)
      const baseUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3000/api'
        : 'https://api.ouraring.com/v2/usercollection';

      const [sleepResponse, dailySleepResponse] = await Promise.all([
        fetch(`${baseUrl}/sleep?start_date=${startStr}&end_date=${endStr}`, {
          headers: { 'Authorization': `Bearer ${profile.oura_token}` }
        }),
        fetch(`${baseUrl}/daily_sleep?start_date=${startStr}&end_date=${endStr}`, {
          headers: { 'Authorization': `Bearer ${profile.oura_token}` }
        }).catch(() => null)
      ]);

      if (!sleepResponse.ok) {
        throw new Error('Failed to fetch Oura data');
      }

      const ouraData = await sleepResponse.json();

      // Build daily sleep score lookup from daily_sleep endpoint
      const scoresByDay = {};
      if (dailySleepResponse?.ok) {
        const dailyData = await dailySleepResponse.json();
        console.log('[SleepSync] daily_sleep response:', dailyData.data?.length, 'days, sample:', dailyData.data?.[0]);
        for (const d of (dailyData.data || [])) {
          scoresByDay[d.day] = d.score;
        }
      } else {
        console.warn('[SleepSync] daily_sleep fetch failed:', dailySleepResponse?.status, dailySleepResponse?.statusText);
      }
      console.log('[SleepSync] scoresByDay:', scoresByDay);

      // Guard: ensure Oura returned a valid data array
      if (!Array.isArray(ouraData.data)) {
        throw new Error('No sleep data returned from Oura');
      }

      // Transform and upsert sleep data
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
        user_id: currentUser.id,
        date: sleep.day,
        total_sleep_minutes: Math.round((sleep.total_sleep_duration || 0) / 60),
        deep_sleep_minutes: Math.round((sleep.deep_sleep_duration || 0) / 60),
        rem_sleep_minutes: Math.round((sleep.rem_sleep_duration || 0) / 60),
        light_sleep_minutes: Math.round((sleep.light_sleep_duration || 0) / 60),
        sleep_score: scoresByDay[sleep.day] || null,
        avg_hr: sleep.average_heart_rate || null,
        pre_sleep_hr: sleep.lowest_heart_rate || null,
      }));

      // Upsert to Supabase
      const { error } = await client
        .from('sleep_data')
        .upsert(sleepRecords, {
          onConflict: 'user_id,date',
          ignoreDuplicates: false
        });

      if (error) throw error;

      if (!silent) {
        alert(`Synced ${sleepRecords.length} nights of sleep data!`);
      }

      // Refresh current view if on challenge detail (skip if called from renderDetail itself)
      if (!skipRefresh) {
        const challengeContainer = document.getElementById('challenge-detail-container');
        if (challengeContainer) {
          const challengeId = challengeContainer.dataset.challengeId;
          if (challengeId) {
            await Challenges.renderDetail(challengeId, { skipSync: true });
          }
        }
      }

      return { success: true, count: sleepRecords.length, error: null };
    } catch (error) {
      console.error('Error syncing sleep data:', error);
      if (!silent) {
        alert('Failed to sync sleep data: ' + error.message);
      }
      return { success: false, count: 0, error: error.message };
    }
  }
};

// Export for use in other modules
window.Comparison = Comparison;
window.SleepSync = SleepSync;
