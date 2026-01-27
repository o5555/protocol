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

  // Get sleep data for challenge participants
  async getChallengeSleepData(challengeId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const challenge = await Challenges.getChallenge(challengeId);
    const participants = challenge.participants.filter(p => p.status === 'accepted');

    const sleepDataPromises = participants.map(async (participant) => {
      const { data, error } = await client
        .from('sleep_data')
        .select('*')
        .eq('user_id', participant.user.id)
        .gte('date', challenge.start_date)
        .lte('date', challenge.end_date)
        .order('date');

      if (error) {
        console.error('Error fetching sleep data:', error);
        return { user: participant.user, data: [] };
      }

      return { user: participant.user, data };
    });

    return Promise.all(sleepDataPromises);
  },

  // Render comparison charts for a challenge
  async renderForChallenge(challengeId) {
    const container = document.getElementById('comparison-charts');
    if (!container) return;

    try {
      const sleepData = await this.getChallengeSleepData(challengeId);

      // Check if we have data
      const hasData = sleepData.some(p => p.data.length > 0);

      if (!hasData) {
        container.innerHTML = `
          <p class="text-oura-muted">No sleep data available yet. Make sure participants have synced their Oura data.</p>
          <button onclick="SleepSync.syncNow()"
            class="mt-4 px-4 py-3 min-h-[44px] bg-oura-teal text-gray-900 rounded-lg text-sm font-medium hover:bg-oura-teal/90">
            Sync My Sleep Data
          </button>
        `;
        return;
      }

      // Clean up existing charts
      Object.values(this.charts).forEach(chart => chart.destroy());
      this.charts = {};

      container.innerHTML = `
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
            <h4 class="text-sm font-medium text-oura-muted mb-2">Average Sleep Duration</h4>
            <canvas id="sleep-duration-chart" height="150"></canvas>
          </div>
        </div>
      `;

      // Create charts
      this.createPreSleepHRChart(sleepData);
      this.createSleepScoreChart(sleepData);
      this.createSleepDurationChart(sleepData);
    } catch (error) {
      console.error('Error rendering comparison charts:', error);
      container.innerHTML = `
        <p class="text-red-400">Failed to load comparison data: ${error.message}</p>
      `;
    }
  },

  // Create pre-sleep HR line chart
  createPreSleepHRChart(participantData) {
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
        labels: dates.map(d => this.formatDate(d)),
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
            ticks: { color: '#9ca3af' },
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
  createSleepScoreChart(participantData) {
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
        labels: dates.map(d => this.formatDate(d)),
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
            ticks: { color: '#9ca3af' },
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

  // Format date for display
  formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
};

// Sleep data sync module
const SleepSync = {
  // Sync sleep data from Oura to Supabase
  // options.silent: suppress alerts and return result object instead
  async syncNow(options = {}) {
    const { silent = false } = options;
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

      // Fetch from Oura API
      const baseUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3000/api'
        : 'https://api.ouraring.com/v2/usercollection';

      const response = await fetch(`${baseUrl}/sleep?start_date=${startStr}&end_date=${endStr}`, {
        headers: {
          'Authorization': `Bearer ${profile.oura_token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Oura data');
      }

      const ouraData = await response.json();

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
        sleep_score: sleep.score,
        avg_hr: sleep.average_heart_rate || null,
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

      // Refresh current view if on challenge detail
      const challengeContainer = document.getElementById('challenge-detail-container');
      if (challengeContainer) {
        const challengeId = challengeContainer.dataset.challengeId;
        if (challengeId) {
          Comparison.renderForChallenge(challengeId);
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
