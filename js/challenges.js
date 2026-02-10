// Challenges Module

const Challenges = {
  // Track in-flight habit toggles to prevent race conditions
  _togglingHabits: new Set(),

  // Create a new challenge
  async create({ protocolId, name, friendIds, mode, startDate: customStartDate }) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    // Use custom start date if provided, otherwise use today
    const startDate = customStartDate ? this.parseLocalDate(customStartDate) : new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);

    // Create challenge
    const { data: challenge, error: challengeError } = await client
      .from('challenges')
      .insert({
        protocol_id: protocolId,
        name,
        creator_id: currentUser.id,
        start_date: this.toLocalDateStr(startDate),
        end_date: this.toLocalDateStr(endDate),
        mode: mode || 'pro'
      })
      .select()
      .single();

    if (challengeError) throw challengeError;

    // Add creator as accepted participant
    const participants = [
      {
        challenge_id: challenge.id,
        user_id: currentUser.id,
        status: 'accepted',
        joined_at: new Date().toISOString()
      },
      ...friendIds.map(friendId => ({
        challenge_id: challenge.id,
        user_id: friendId,
        status: 'invited',
        invited_by: currentUser.id
      }))
    ];

    const { error: participantError } = await client
      .from('challenge_participants')
      .insert(participants);

    if (participantError) throw participantError;

    return challenge;
  },

  // Get challenges for current user
  async getMyChallenges() {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    const { data, error } = await client
      .from('challenge_participants')
      .select(`
        id,
        status,
        joined_at,
        challenge:challenges(
          id,
          name,
          mode,
          start_date,
          end_date,
          created_at,
          protocol:protocols(id, name, icon),
          creator:profiles!challenges_creator_id_fkey(id, email, display_name)
        )
      `)
      .eq('user_id', currentUser.id)
      .order('created_at', { referencedTable: 'challenges', ascending: false });

    if (error) throw error;

    return data.filter(p => p.challenge).map(p => ({
      participantId: p.id,
      status: p.status,
      joinedAt: p.joined_at,
      ...p.challenge,
      daysRemaining: this.getDaysRemaining(p.challenge.end_date),
      isActive: this.isActive(p.challenge.start_date, p.challenge.end_date)
    }));
  },

  // Get challenge invitations
  async getInvitations() {
    const challenges = await this.getMyChallenges();
    return challenges.filter(c => c.status === 'invited');
  },

  // Get active challenges
  async getActiveChallenges() {
    const challenges = await this.getMyChallenges();
    return challenges.filter(c => c.status === 'accepted' && c.isActive);
  },

  // Get challenge by ID with full details
  async getChallenge(challengeId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client
      .from('challenges')
      .select(`
        id,
        name,
        mode,
        start_date,
        end_date,
        created_at,
        protocol:protocols(
          id,
          name,
          description,
          icon,
          habits:protocol_habits(id, title, description, sort_order)
        ),
        creator:profiles!challenges_creator_id_fkey(id, email, display_name),
        participants:challenge_participants(
          id,
          status,
          joined_at,
          user:profiles!challenge_participants_user_id_fkey(id, email, display_name)
        )
      `)
      .eq('id', challengeId)
      .single();

    if (error) throw error;

    // Sort habits
    if (data.protocol?.habits) {
      data.protocol.habits.sort((a, b) => a.sort_order - b.sort_order);
    }

    return {
      ...data,
      daysRemaining: this.getDaysRemaining(data.end_date),
      dayNumber: this.getDayNumber(data.start_date),
      isActive: this.isActive(data.start_date, data.end_date)
    };
  },

  // Accept challenge invitation
  async acceptInvitation(participantId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    // Get the participant record to check who invited us
    const { data: participant, error: fetchError } = await client
      .from('challenge_participants')
      .select('id, invited_by')
      .eq('id', participantId)
      .single();

    if (fetchError) throw fetchError;

    // Accept the invitation
    const { data, error } = await client
      .from('challenge_participants')
      .update({
        status: 'accepted',
        joined_at: new Date().toISOString()
      })
      .eq('id', participantId)
      .select()
      .single();

    if (error) throw error;

    // Auto-friend the inviter if not already friends
    if (participant.invited_by && participant.invited_by !== currentUser.id) {
      try {
        // Check if already friends
        const { data: existing } = await client
          .from('friendships')
          .select('id')
          .or(`and(user_id.eq.${currentUser.id},friend_id.eq.${participant.invited_by}),and(user_id.eq.${participant.invited_by},friend_id.eq.${currentUser.id})`)
          .maybeSingle();

        if (!existing) {
          // Create auto-accepted friendship (current user as user_id for RLS)
          await client
            .from('friendships')
            .insert({
              user_id: currentUser.id,
              friend_id: participant.invited_by,
              status: 'accepted'
            });
        }
      } catch (friendError) {
        // Log but don't fail the invitation acceptance
        console.error('Auto-friend error:', friendError);
      }
    }

    return data;
  },

  // Decline challenge invitation
  async declineInvitation(participantId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client
      .from('challenge_participants')
      .update({ status: 'declined' })
      .eq('id', participantId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Delete a challenge (only creator can delete)
  async deleteChallenge(challengeId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    // Check if user is the creator
    const challenge = await this.getChallenge(challengeId);
    if (challenge.creator.id !== currentUser.id) {
      throw new Error('Only the challenge creator can delete this challenge');
    }

    // Delete the challenge (cascades to participants and completions)
    const { error } = await client
      .from('challenges')
      .delete()
      .eq('id', challengeId);

    if (error) throw error;
  },

  // Handle delete challenge with confirmation
  async handleDeleteChallenge(challengeId) {
    if (!confirm('Are you sure you want to delete this challenge? This cannot be undone.')) {
      return;
    }

    try {
      await this.deleteChallenge(challengeId);
      // Clear dashboard cache so it doesn't show deleted challenge
      if (typeof Cache !== 'undefined') {
        Cache.clear('dashboard');
      }
      App.navigateTo('challenges');
    } catch (error) {
      console.error('Error deleting challenge:', error);
      alert('Failed to delete challenge: ' + error.message);
    }
  },

  // Get habit completions for a challenge/user/date
  async getHabitCompletions(challengeId, userId, date) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client
      .from('habit_completions')
      .select('habit_id')
      .eq('challenge_id', challengeId)
      .eq('user_id', userId)
      .eq('completed_date', date);

    if (error) throw error;
    return data.map(c => c.habit_id);
  },

  // Toggle habit completion (guarded against rapid double-clicks)
  async toggleHabit(challengeId, habitId, date) {
    const key = `${challengeId}:${habitId}:${date}`;
    if (this._togglingHabits.has(key)) return;

    this._togglingHabits.add(key);
    try {
      const client = SupabaseClient.client;
      if (!client) throw new Error('Supabase not initialized');

      const currentUser = await SupabaseClient.getCurrentUser();
      if (!currentUser) throw new Error('Not authenticated');

      // Check if already completed
      const { data: existing } = await client
        .from('habit_completions')
        .select('id')
        .eq('challenge_id', challengeId)
        .eq('habit_id', habitId)
        .eq('user_id', currentUser.id)
        .eq('completed_date', date)
        .maybeSingle();

      if (existing) {
        // Remove completion
        await client
          .from('habit_completions')
          .delete()
          .eq('id', existing.id);
        return false;
      } else {
        // Add completion
        await client
          .from('habit_completions')
          .insert({
            challenge_id: challengeId,
            habit_id: habitId,
            user_id: currentUser.id,
            completed_date: date
          });
        return true;
      }
    } finally {
      this._togglingHabits.delete(key);
    }
  },

  // Get participant progress for a challenge
  async getParticipantProgress(challengeId) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const challenge = await this.getChallenge(challengeId);
    const habits = Protocols.getHabitsForMode(challenge.protocol, challenge.mode || 'pro');
    const totalHabits = habits.length;
    const dayNumber = challenge.dayNumber;

    const participants = challenge.participants.filter(p => p.status === 'accepted');

    const progressPromises = participants.map(async (participant) => {
      const { data, error } = await client
        .from('habit_completions')
        .select('id')
        .eq('challenge_id', challengeId)
        .eq('user_id', participant.user.id);

      if (error) {
        console.error('Error fetching completions:', error);
        return {
          user: participant.user,
          totalCompletions: 0,
          possibleCompletions: dayNumber * totalHabits,
          percentage: 0
        };
      }

      const totalCompletions = data.length;
      const possibleCompletions = dayNumber * totalHabits;
      const percentage = possibleCompletions > 0
        ? Math.round((totalCompletions / possibleCompletions) * 100)
        : 0;

      return {
        user: participant.user,
        totalCompletions,
        possibleCompletions,
        percentage
      };
    });

    return Promise.all(progressPromises);
  },

  // Helper: Format a Date as YYYY-MM-DD local date string
  toLocalDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // Helper: Parse YYYY-MM-DD as local midnight (not UTC)
  parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  // Helper: Calculate days remaining
  getDaysRemaining(endDate) {
    const end = this.parseLocalDate(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  },

  // Helper: Calculate current day number
  getDayNumber(startDate, duration = 30) {
    const start = this.parseLocalDate(startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today < start) return 0;
    const diff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    return Math.min(diff + 1, duration);
  },

  // Helper: Check if challenge is active
  isActive(startDate, endDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = this.parseLocalDate(startDate);
    const end = this.parseLocalDate(endDate);
    return today >= start && today <= end;
  },

  // Render challenges list page
  async renderList() {
    const container = document.getElementById('challenges-container');
    if (!container) return;

    try {
      const [invitations, activeChallenges] = await Promise.all([
        this.getInvitations(),
        this.getActiveChallenges()
      ]);

      container.innerHTML = `
        <!-- Create Challenge Button -->
        <div class="mb-6">
          <button onclick="Challenges.showCreateModal()"
            class="w-full py-3 min-h-[48px] bg-oura-teal text-gray-900 font-semibold rounded-lg hover:bg-oura-teal/90">
            + Create New Challenge
          </button>
        </div>

        <!-- Invitations -->
        ${invitations.length > 0 ? `
          <div class="bg-yellow-900/20 border border-yellow-600 rounded-lg p-6 mb-6">
            <h3 class="text-lg font-semibold mb-4 text-yellow-400">Challenge Invitations (${invitations.length})</h3>
            <div class="space-y-3">
              ${invitations.map(inv => `
                <div class="bg-oura-card rounded-2xl p-4">
                  <div class="flex items-start justify-between">
                    <div>
                      <p class="font-semibold">${escapeHtml(inv.name)} ${Protocols.renderModeBadge(inv.mode || 'pro')}</p>
                      <p class="text-sm text-oura-muted">${escapeHtml(inv.protocol.icon)} ${escapeHtml(inv.protocol.name)}</p>
                      <p class="text-sm text-oura-muted">From: ${escapeHtml(inv.creator.display_name || inv.creator.email)}</p>
                    </div>
                    <div class="flex gap-2">
                      <button onclick="Challenges.handleAcceptInvite('${inv.participantId}')"
                        class="px-4 py-2 min-h-[44px] bg-oura-teal text-gray-900 rounded-lg text-sm font-medium">
                        Join
                      </button>
                      <button onclick="Challenges.handleDeclineInvite('${inv.participantId}')"
                        class="px-4 py-2 min-h-[44px] bg-oura-border text-white rounded-lg text-sm font-medium">
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Active Challenges -->
        <div class="bg-oura-card rounded-2xl p-6">
          <h3 class="text-lg font-semibold mb-4">Active Challenges (${activeChallenges.length})</h3>
          ${activeChallenges.length > 0 ? `
            <div class="space-y-3">
              ${activeChallenges.map(challenge => `
                <div onclick="App.navigateTo('challenge-detail', '${challenge.id}')"
                  class="bg-oura-subtle rounded-lg p-4 cursor-pointer hover:bg-oura-border transition-colors">
                  <div class="flex items-start justify-between">
                    <div>
                      <p class="font-semibold">${escapeHtml(challenge.name)} ${Protocols.renderModeBadge(challenge.mode || 'pro')}</p>
                      <p class="text-sm text-oura-muted">${escapeHtml(challenge.protocol.icon)} ${escapeHtml(challenge.protocol.name)}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-oura-teal font-semibold">${challenge.daysRemaining} days left</p>
                      <p class="text-sm text-oura-muted">Day ${this.getDayNumber(challenge.start_date)} of 30</p>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <p class="text-oura-muted">No active challenges. Create one to get started!</p>
          `}
        </div>
      `;
    } catch (error) {
      console.error('Error rendering challenges:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p class="text-red-400">Failed to load challenges: ${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  },

  // Render challenge detail page (Redesigned - simplified UX)
  async renderDetail(challengeId, { skipSync = false } = {}) {
    const container = document.getElementById('challenge-detail-container');
    if (!container) return;

    try {
      const currentUser = await SupabaseClient.getCurrentUser();
      const challenge = await this.getChallenge(challengeId);
      const now = new Date();
      const today = this.toLocalDateStr(now);

      // Store challengeId for sync refresh
      container.dataset.challengeId = challengeId;

      // Auto-sync Oura data silently before fetching (skip on post-sync refresh)
      if (!skipSync && typeof SleepSync !== 'undefined') {
        container.innerHTML = `
          <div class="nav-bar flex items-center justify-between mb-4">
            <button onclick="App.navigateTo('challenges')" class="min-h-[44px] inline-flex items-center text-oura-accent hover:text-white">
              &larr; Back
            </button>
            <span class="text-base font-medium">${escapeHtml(challenge.name)}</span>
            <span style="width: 50px;"></span>
          </div>
          <div class="text-center py-10 text-oura-muted text-sm">Syncing Oura data...</div>
        `;
        await SleepSync.syncNow({ silent: true, skipRefresh: true });
      }

      // Fetch sleep data for comparison
      const { sleepData } = await Comparison.getChallengeSleepData(challengeId);

      // Find current user's data
      const myData = sleepData.find(p => p.user.id === currentUser.id) || { baselineData: [], challengeData: [] };
      const myBaseline = Comparison.calcAverages(myData.baselineData, 30);
      const myCurrent = Comparison.calcAverages(myData.challengeData, myData.challengeDays || 1);

      // Calculate improvement percentages for ALL metrics
      const calcImprovement = (baseVal, currVal, lowerIsBetter = false) => {
        if (!baseVal || !currVal) return { pct: null, direction: 'neutral' };
        const pct = Math.round(((currVal - baseVal) / baseVal) * 100);
        let direction = 'neutral';
        if (lowerIsBetter) {
          // For HR: negative % = improvement (going down is good)
          direction = pct < 0 ? 'up' : pct > 0 ? 'down' : 'neutral';
        } else {
          // For score/deep: positive % = improvement
          direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
        }
        return { pct, direction };
      };

      const improvements = {
        score: calcImprovement(myBaseline.score, myCurrent.score, false),
        hr: calcImprovement(myBaseline.hr, myCurrent.hr, true),
        avghr: calcImprovement(
          this.calcAvg(myData.baselineData.filter(d => d.avg_hr).map(d => d.avg_hr)),
          this.calcAvg(myData.challengeData.filter(d => d.avg_hr).map(d => d.avg_hr)),
          true  // lower is better for avg HR too
        ),
        deep: calcImprovement(
          this.calcAvg(myData.baselineData.filter(d => d.deep_sleep_minutes).map(d => d.deep_sleep_minutes)),
          this.calcAvg(myData.challengeData.filter(d => d.deep_sleep_minutes).map(d => d.deep_sleep_minutes)),
          false
        )
      };

      // Default to sleep score for initial display
      const currentMetric = 'score';
      const imp = improvements[currentMetric];
      const improvementPct = imp.pct;
      const improvementDirection = imp.direction;
      const heroEmoji = improvementDirection === 'up' ? '📈' : improvementDirection === 'down' ? '📉' : '📊';

      // Build leaderboard with improvement %
      const leaderboard = sleepData
        .map(p => {
          const baseline = Comparison.calcAverages(p.baselineData, 30);
          const current = Comparison.calcAverages(p.challengeData, p.challengeDays || 1);
          let pct = null;
          if (baseline.score && current.score) {
            pct = Math.round(((current.score - baseline.score) / baseline.score) * 100);
          }
          return {
            user: p.user,
            baselineScore: baseline.score,
            currentScore: current.score,
            improvementPct: pct,
            isMe: p.user.id === currentUser.id
          };
        })
        .filter(p => p.improvementPct !== null)
        .sort((a, b) => b.improvementPct - a.improvementPct);

      // Assign ranks
      const rankEmojis = ['🥇', '🥈', '🥉'];
      leaderboard.forEach((p, i) => {
        p.rank = i < 3 ? rankEmojis[i] : `${i + 1}`;
      });

      // Find my rank
      const myRank = leaderboard.findIndex(p => p.isMe) + 1;

      // Check if we have no challenge data yet (just started, only baseline)
      const hasNoChallengeData = myData.challengeData.length === 0;
      const participantCount = challenge.participants.filter(p => p.status === 'accepted').length;

      if (hasNoChallengeData) {
        // Celebration hero view - "You're In!"
        container.innerHTML = `
          <!-- Navigation -->
          <div class="flex items-center justify-between mb-4">
            <button onclick="App.navigateTo('challenges')" class="min-h-[44px] inline-flex items-center text-oura-accent hover:text-white">
              &larr; Back
            </button>
            <span class="text-base font-semibold">${escapeHtml(challenge.name)}</span>
            <span style="width: 50px;"></span>
          </div>

          <!-- Challenge Active badge -->
          <div class="flex justify-center mb-5">
            <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium" style="border: 1px solid rgba(74, 222, 128, 0.3); color: #4ade80;">
              <span class="w-2 h-2 rounded-full inline-block" style="background: #4ade80;"></span>
              Challenge Active
            </div>
          </div>

          <!-- Celebration Hero Card -->
          <div class="rounded-2xl p-6 text-center mb-6" style="background: linear-gradient(135deg, #0f1a2e 0%, #1a1035 100%); border: 1px solid rgba(74, 222, 128, 0.15);">
            <div class="text-5xl mb-4">🚀</div>
            <div class="text-2xl font-bold mb-3">You're In!</div>
            <p class="text-sm leading-relaxed mb-6" style="color: #6b7280;">
              Your 30-day challenge has begun.<br>
              First results arrive tomorrow morning.
            </p>
            <div class="flex justify-center gap-10">
              <div class="text-center">
                <div class="text-3xl font-bold" style="color: #4ade80;">${challenge.daysRemaining}</div>
                <div class="text-xs uppercase tracking-wider mt-1" style="color: #6b7280;">Days Left</div>
              </div>
              <div class="text-center">
                <div class="text-3xl font-bold" style="color: #4ade80;">${participantCount}</div>
                <div class="text-xs uppercase tracking-wider mt-1" style="color: #6b7280;">Challengers</div>
              </div>
            </div>
          </div>

          <!-- Baseline Section -->
          ${myBaseline.score ? `
            <div class="text-xs text-oura-muted uppercase tracking-widest text-center mb-3">Your Baseline</div>
            <div class="flex items-center justify-between rounded-xl px-4 py-3.5 mb-6" style="background: #0f1525; border: 1px solid #1a2035;">
              <span class="text-sm" style="color: #6b7280;">30-day average sleep score</span>
              <span class="text-lg font-bold">${Math.round(myBaseline.score)}</span>
            </div>
          ` : ''}

          <!-- Invite Friends -->
          <button onclick="Challenges.showInviteFriendsModal('${challengeId}')"
            class="w-full py-3 min-h-[44px] bg-oura-card text-oura-muted rounded-xl text-sm font-medium hover:bg-oura-subtle transition-colors">
            + Invite Friends
          </button>

          <!-- Settings cogwheel -->
          <div class="flex justify-center mt-6">
            <button onclick="Challenges.showSettingsMenu('${challengeId}', ${challenge.creator.id === currentUser.id})"
              class="p-3 text-oura-muted hover:text-white transition-colors">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        `;
      } else {
      container.innerHTML = `
        <!-- Navigation - minimal -->
        <div class="mb-4">
          <button onclick="App.navigateTo('challenges')" class="min-h-[44px] inline-flex items-center text-oura-accent hover:text-white">
            &larr; Back
          </button>
        </div>

        <!-- Hero Stat -->
        <div id="hero-stat-container" class="text-center py-6 mb-4">
          <div class="text-xs text-oura-muted uppercase tracking-wider mb-2">Your Sleep Score</div>
          ${improvementPct !== null ? `
            <div class="text-6xl font-bold leading-none" style="color: ${improvementDirection === 'up' ? '#4ade80' : improvementDirection === 'down' ? '#f87171' : '#ffffff'}">
              ${improvementPct > 0 ? '+' : ''}${improvementPct}%
            </div>
            <div class="text-sm text-oura-muted mt-2">vs. your baseline</div>
            <div class="inline-block mt-3 px-3 py-1.5 rounded-full text-xs font-bold" style="background: ${improvementDirection === 'up' ? 'rgba(74, 222, 128, 0.15)' : improvementDirection === 'down' ? 'rgba(248, 113, 113, 0.15)' : '#1a2035'}; color: ${improvementDirection === 'up' ? '#4ade80' : improvementDirection === 'down' ? '#f87171' : '#6b7280'}">
              ${heroEmoji} ${improvementDirection === 'up' ? 'TRENDING UP' : improvementDirection === 'down' ? 'NEEDS ATTENTION' : 'STEADY'}
            </div>
          ` : `
            <div class="text-4xl font-bold text-oura-muted leading-none">--</div>
            <div class="text-sm text-oura-muted mt-2">Waiting for sleep data</div>
          `}
        </div>

        <!-- Stats Row -->
        <div id="stats-row-container" class="flex justify-around mb-5">
          <div class="text-center">
            <div class="text-3xl font-bold text-oura-muted">${myBaseline.score ? Math.round(myBaseline.score) : '--'}</div>
            <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Baseline</div>
          </div>
          <div class="text-center">
            <div class="text-3xl font-bold" style="color: #4ade80">${myCurrent.score ? Math.round(myCurrent.score) : '--'}</div>
            <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Challenge</div>
          </div>
        </div>

        <!-- Metric Toggle + Chart -->
        <div class="mb-6">
          <div class="flex items-center justify-center mb-3">
            <div class="flex gap-2" id="metric-toggle">
              <button onclick="Challenges.switchMetric('${challengeId}', 'score')" class="metric-btn active flex-1 px-4 py-1.5 text-xs rounded-md text-center" style="background: #1a2035; color: #fff" data-metric="score">SLEEP</button>
              <button onclick="Challenges.switchMetric('${challengeId}', 'avghr')" class="metric-btn flex-1 px-4 py-1.5 text-xs rounded-md text-center text-oura-muted hover:bg-oura-card" data-metric="avghr">AVG HR</button>
              <button onclick="Challenges.switchMetric('${challengeId}', 'hr')" class="metric-btn flex-1 px-4 py-1.5 text-xs rounded-md text-center text-oura-muted hover:bg-oura-card" data-metric="hr">LOW HR</button>
              <button onclick="Challenges.switchMetric('${challengeId}', 'deep')" class="metric-btn flex-1 px-4 py-1.5 text-xs rounded-md text-center text-oura-muted hover:bg-oura-card" data-metric="deep">DEEP</button>
            </div>
          </div>
          <div class="rounded-2xl p-4" style="background: #0a0a14">
            <div id="trend-chart-container" class="h-48">
              <canvas id="main-trend-chart"></canvas>
            </div>
          </div>
        </div>

        <!-- Leaderboard -->
        <div class="mb-6">
          <div class="text-xs text-oura-muted uppercase tracking-wider mb-3">CHALLENGE STANDINGS</div>
          <div class="space-y-2">
            ${leaderboard.length > 0 ? leaderboard.map(p => {
              const name = p.user.display_name || p.user.email.split('@')[0];
              const initial = escapeHtml(name.charAt(0).toUpperCase());
              return `
                <div class="flex items-center p-3.5 rounded-xl" style="background: ${p.isMe ? '#1a2035' : '#0f1525'}; ${p.isMe ? 'border: 1px solid rgba(108, 99, 255, 0.2);' : ''}">
                  <span class="text-lg mr-3 w-7">${p.rank}</span>
                  <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm mr-3" style="background: #1a2035">${p.isMe ? '👤' : initial}</div>
                  <div class="flex-1">
                    <div class="text-sm font-medium">${p.isMe ? 'You' : escapeHtml(name)}</div>
                    <div class="text-xs text-oura-muted">${Math.round(p.baselineScore)} → ${Math.round(p.currentScore)}</div>
                  </div>
                  <span class="text-lg font-semibold" style="color: ${p.improvementPct >= 0 ? '#4ade80' : '#f87171'}">
                    ${p.improvementPct > 0 ? '+' : ''}${p.improvementPct}%
                  </span>
                </div>
              `;
            }).join('') : `
              <div class="rounded-xl p-4 text-center" style="background: #0f1525">
                <p class="text-oura-muted text-sm">No challenge data yet</p>
              </div>
            `}
          </div>
        </div>

        <!-- Day Badge - Protocol info -->
        <div class="text-center py-3 px-4 bg-oura-card rounded-lg mb-4">
          <span class="text-sm text-oura-muted">${escapeHtml(challenge.protocol.icon)} ${escapeHtml(challenge.protocol.name)} · Day <strong class="text-white">${challenge.dayNumber}</strong> of 30</span>
        </div>

        <!-- Details Link -->
        <button onclick="Challenges.showDetailsModal('${challengeId}')"
          class="w-full text-center py-4 text-oura-accent text-sm font-medium hover:text-white transition-colors">
          View detailed metrics & habits →
        </button>

        <!-- Invite Friends -->
        <button onclick="Challenges.showInviteFriendsModal('${challengeId}')"
          class="w-full py-3 min-h-[44px] bg-oura-card text-oura-muted rounded-xl text-sm font-medium hover:bg-oura-subtle transition-colors">
          + Invite Friends
        </button>

        <!-- Settings cogwheel -->
        <div class="flex justify-center mt-6">
          <button onclick="Challenges.showSettingsMenu('${challengeId}', ${challenge.creator.id === currentUser.id})"
            class="p-3 text-oura-muted hover:text-white transition-colors">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      `;
      }

      // Store data for metric switching
      this._currentChallengeData = { myData, challenge, improvements };

      // Render the main Chart.js trend chart
      if (!hasNoChallengeData) {
        this.renderMainChart(myData, challenge.start_date, 'score');
      }

    } catch (error) {
      console.error('Error rendering challenge detail:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p class="text-red-400">Failed to load challenge: ${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  },

  // Render SVG trend chart (baseline → experiment) - Style C Compact
  renderTrendChart(userData, challengeStartDate, metric = 'score') {
    const { baselineData, challengeData } = userData;

    // Get field name based on metric
    const fieldMap = {
      score: 'sleep_score',
      hr: 'pre_sleep_hr',
      avghr: 'avg_hr',
      deep: 'deep_sleep_minutes'
    };
    const field = fieldMap[metric] || 'sleep_score';

    // Get baseline average
    const baselineVals = baselineData.filter(d => d[field]).map(d => d[field]);
    const baselineVal = baselineVals.length > 0 ? baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length : null;

    // Get experiment data points (last few days)
    const experimentVals = challengeData.filter(d => d[field]).map(d => d[field]);

    // Calculate challenge period average (this is what we compare against baseline)
    const challengeAvg = experimentVals.length > 0 ? experimentVals.reduce((a, b) => a + b, 0) / experimentVals.length : null;

    // Colors
    const colors = {
      baselineBox: '#1a2035',
      baselineBorder: '#2a3550',
      green: '#4ade80',
      red: '#f87171',
      textMuted: '#6b7280',
      dotMuted: '#3a4560'
    };

    // Determine if improving (compare averages, not last measurement)
    const lowerIsBetter = metric === 'hr' || metric === 'avghr';
    const isImproving = baselineVal && challengeAvg ? (lowerIsBetter ? challengeAvg < baselineVal : challengeAvg > baselineVal) : false;
    const lineColor = challengeAvg === null ? colors.dotMuted : (isImproving ? colors.green : colors.red);

    // Fixed baseline box position (vertically centered) - no jumping!
    const fixedBaselineY = 65;

    // Calculate Y range for the graph line only
    const allVals = [...experimentVals];
    const minVal = allVals.length > 0 ? Math.min(...allVals) * 0.85 : 0;
    const maxVal = allVals.length > 0 ? Math.max(...allVals) * 1.15 : 100;
    const range = maxVal - minVal || 1;
    const getY = (val) => val ? 30 + (1 - (val - minVal) / range) * 70 : 65;

    // Build experiment points - show up to 5 recent days
    const maxDots = 5;
    const recentVals = experimentVals.slice(-maxDots);
    const startX = 95;
    const endX = 250; // Reduced to leave room for label
    const dotSpacing = recentVals.length > 1 ? (endX - startX) / (recentVals.length - 1) : 0;

    let dotsHTML = '';
    let pathD = '';
    let lastDotX = endX;
    let lastDotY = 65;

    if (recentVals.length > 0) {
      // Build path and dots
      recentVals.forEach((val, i) => {
        const x = recentVals.length === 1 ? (startX + endX) / 2 : startX + i * dotSpacing;
        const y = getY(val);
        const isLast = i === recentVals.length - 1;
        const dotSize = isLast ? 8 : 5;

        if (i === 0) {
          pathD = `M${x},${y}`;
        } else {
          pathD += ` L${x},${y}`;
        }

        // Dot
        dotsHTML += `<circle cx="${x}" cy="${y}" r="${dotSize}" fill="${lineColor}" />`;

        if (isLast) {
          lastDotX = x;
          lastDotY = y;
        }
      });
    }

    // Show challenge AVERAGE label (to the right of last dot)
    const avgLabelX = Math.min(lastDotX + 25, 290); // Position right of dot, but not past edge
    const avgLabel = challengeAvg ? `<text x="${avgLabelX}" y="${lastDotY + 5}" text-anchor="middle" fill="${lineColor}" font-size="14" font-weight="600">${Math.round(challengeAvg)}</text>` : '';

    // Format dates for labels
    const formatDateShort = (dateStr) => {
      const d = this.parseLocalDate(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    const startDateLabel = formatDateShort(challengeStartDate);
    const todayLabel = formatDateShort(this.toLocalDateStr(new Date()));

    return `
      <svg viewBox="0 0 300 145" class="w-full h-full">
        <!-- Baseline box (fixed position - doesn't jump) -->
        <rect x="10" y="${fixedBaselineY - 22}" width="55" height="44" rx="6" fill="${colors.baselineBox}" stroke="${colors.baselineBorder}" stroke-width="1" />
        ${baselineVal ? `
          <text x="37" y="${fixedBaselineY + 6}" text-anchor="middle" fill="#fff" font-size="16" font-weight="600">${Math.round(baselineVal)}</text>
        ` : `
          <text x="37" y="${fixedBaselineY + 4}" text-anchor="middle" fill="${colors.textMuted}" font-size="11">--</text>
        `}
        <text x="37" y="${fixedBaselineY + 32}" text-anchor="middle" fill="${colors.textMuted}" font-size="8" text-transform="uppercase" letter-spacing="0.5">BASELINE</text>

        ${recentVals.length > 0 ? `
          <!-- Experiment path -->
          <path d="${pathD}" stroke="${lineColor}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />

          <!-- Dots -->
          ${dotsHTML}

          <!-- Challenge average label -->
          ${avgLabel}

          <!-- Date labels -->
          <text x="${startX}" y="125" text-anchor="middle" fill="${colors.textMuted}" font-size="9">${startDateLabel}</text>
          <text x="${lastDotX}" y="125" text-anchor="middle" fill="${colors.textMuted}" font-size="9">${todayLabel}</text>
        ` : `
          <!-- No data placeholder -->
          <text x="180" y="70" text-anchor="middle" fill="${colors.textMuted}" font-size="11">Data will appear as you progress</text>
        `}
      </svg>
    `;
  },

  // Render Chart.js line chart on the main challenge detail page (gray baseline → green challenge)
  renderMainChart(userData, challengeStartDate, metric = 'score') {
    const { baselineData, challengeData } = userData;
    const fieldMap = { score: 'sleep_score', hr: 'pre_sleep_hr', avghr: 'avg_hr', deep: 'deep_sleep_minutes' };
    const field = fieldMap[metric] || 'sleep_score';
    const lowerIsBetter = metric === 'hr' || metric === 'avghr';

    // Combine all data sorted by date
    const allData = [
      ...baselineData.map(d => ({ ...d, period: 'baseline' })),
      ...challengeData.map(d => ({ ...d, period: 'challenge' }))
    ].sort((a, b) => a.date.localeCompare(b.date)).filter(d => d[field] != null);

    // Destroy previous chart instance if exists
    if (this._mainChartInstance) {
      this._mainChartInstance.destroy();
      this._mainChartInstance = null;
    }

    const canvas = document.getElementById('main-trend-chart');
    if (!canvas || allData.length === 0) return;

    const challengeColor = lowerIsBetter ? '#2dd4bf' : '#4ade80';

    this._mainChartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: allData.map(d => {
          const dt = new Date(d.date + 'T00:00:00');
          return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }),
        datasets: [{
          data: allData.map(d => d[field]),
          borderColor: '#6b7280',
          borderWidth: 2,
          pointRadius: allData.map((d, i) => i === allData.length - 1 ? 6 : 3),
          pointBackgroundColor: allData.map(d => d.period === 'challenge' ? challengeColor : '#6b7280'),
          pointBorderColor: allData.map(d => d.period === 'challenge' ? challengeColor : '#6b7280'),
          pointBorderWidth: 0,
          tension: 0.3,
          fill: false,
          segment: {
            borderColor: ctx => {
              // Only green when BOTH endpoints are challenge data
              if (allData[ctx.p0DataIndex]?.period === 'challenge' && allData[ctx.p1DataIndex]?.period === 'challenge') return challengeColor;
              // Transition segment (last baseline → first challenge) stays gray
              return '#6b7280';
            }
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1a2e',
            titleColor: '#fff',
            bodyColor: challengeColor,
            callbacks: {
              label: (ctx) => {
                const val = Math.round(ctx.parsed.y);
                const units = { score: 'pts', hr: 'bpm', avghr: 'bpm', deep: 'min' };
                return val + ' ' + (units[metric] || '');
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#6b7280', font: { size: 10 }, maxTicksLimit: 6 },
            grid: { display: false }
          },
          y: {
            ticks: { color: '#6b7280', font: { size: 10 } },
            grid: { color: '#ffffff10' }
          }
        }
      }
    });
  },

  // Helper to calculate average
  calcAvg(values) {
    if (!values || values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  },

  // Switch metric on trend chart AND stats row
  switchMetric(challengeId, metric) {
    // Update toggle buttons
    document.querySelectorAll('.metric-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.style.background = 'transparent';
      btn.style.color = '#6b7280';
    });
    const activeBtn = document.querySelector(`.metric-btn[data-metric="${metric}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.style.background = '#1a2035';
      activeBtn.style.color = '#ffffff';
    }

    if (!this._currentChallengeData) return;
    const { myData, challenge, improvements } = this._currentChallengeData;

    // Update hero stat
    const heroContainer = document.getElementById('hero-stat-container');
    if (heroContainer && improvements) {
      const imp = improvements[metric];
      const labels = { score: 'Your Sleep Score', hr: 'Your Lowest HR', avghr: 'Your Avg HR (Sleep)', deep: 'Your Deep Sleep' };

      if (imp.pct !== null) {
        const direction = imp.direction;
        const heroEmoji = direction === 'up' ? '📈' : direction === 'down' ? '📉' : '📊';
        heroContainer.innerHTML = `
          <div class="text-xs text-oura-muted uppercase tracking-wider mb-2">${labels[metric]}</div>
          <div class="text-6xl font-bold leading-none" style="color: ${direction === 'up' ? '#4ade80' : direction === 'down' ? '#f87171' : '#ffffff'}">
            ${imp.pct > 0 ? '+' : ''}${imp.pct}%
          </div>
          <div class="text-sm text-oura-muted mt-2">vs. your baseline</div>
          <div class="inline-block mt-3 px-3 py-1.5 rounded-full text-xs font-bold" style="background: ${direction === 'up' ? 'rgba(74, 222, 128, 0.15)' : direction === 'down' ? 'rgba(248, 113, 113, 0.15)' : '#1a2035'}; color: ${direction === 'up' ? '#4ade80' : direction === 'down' ? '#f87171' : '#6b7280'}">
            ${heroEmoji} ${direction === 'up' ? 'TRENDING UP' : direction === 'down' ? 'NEEDS ATTENTION' : 'STEADY'}
          </div>
        `;
      } else {
        heroContainer.innerHTML = `
          <div class="text-xs text-oura-muted uppercase tracking-wider mb-2">${labels[metric]}</div>
          <div class="text-4xl font-bold text-oura-muted leading-none">--</div>
          <div class="text-sm text-oura-muted mt-2">Sync your Oura ring to see progress</div>
        `;
      }
    }

    // Update stats row
    const statsRow = document.getElementById('stats-row-container');
    if (statsRow && improvements) {
      const imp = improvements[metric];
      const fieldMap = { score: 'sleep_score', hr: 'pre_sleep_hr', avghr: 'avg_hr', deep: 'deep_sleep_minutes' };
      const field = fieldMap[metric];

      const baselineVals = myData.baselineData.filter(d => d[field]).map(d => d[field]);
      const challengeVals = myData.challengeData.filter(d => d[field]).map(d => d[field]);
      const baselineAvg = baselineVals.length > 0 ? Math.round(baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length) : null;
      const challengeAvg = challengeVals.length > 0 ? Math.round(challengeVals.reduce((a, b) => a + b, 0) / challengeVals.length) : null;

      const changeColor = imp.pct !== null ? (imp.direction === 'up' ? '#4ade80' : imp.direction === 'down' ? '#f87171' : '#6b7280') : '#6b7280';

      statsRow.innerHTML = `
        <div class="text-center">
          <div class="text-3xl font-bold text-oura-muted">${baselineAvg ?? '--'}</div>
          <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Baseline</div>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold" style="color: #4ade80">${challengeAvg ?? '--'}</div>
          <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Challenge</div>
        </div>
      `;
    }

    // Re-render Chart.js chart
    this.renderMainChart(myData, challenge.start_date, metric);
  },

  // Show detailed metric view for the challenge (baseline + challenge data)
  async showMetricDetailModal(challengeId) {
    if (!this._currentChallengeData) return;

    const { myData, challenge } = this._currentChallengeData;
    const { baselineData, challengeData } = myData;

    // Get current active metric from toggle
    const activeBtn = document.querySelector('.metric-btn.active');
    const metric = activeBtn?.dataset?.metric || 'score';

    // Config for each metric
    const configs = {
      score: { label: 'Sleep Score', unit: 'pts', color: '#4ade80', field: 'sleep_score' },
      hr: { label: 'Lowest Heart Rate', unit: 'bpm', color: '#2dd4bf', field: 'pre_sleep_hr' },
      avghr: { label: 'Average Heart Rate', unit: 'bpm', color: '#60a5fa', field: 'avg_hr' },
      deep: { label: 'Deep Sleep', unit: 'min', color: '#c084fc', field: 'deep_sleep_minutes' }
    };
    const config = configs[metric];
    const lowerIsBetter = metric === 'hr' || metric === 'avghr';

    // Calculate stats
    const baselineVals = baselineData.filter(d => d[config.field]).map(d => d[config.field]);
    const challengeVals = challengeData.filter(d => d[config.field]).map(d => d[config.field]);

    const baselineAvg = baselineVals.length > 0 ? Math.round(baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length) : null;
    const challengeAvg = challengeVals.length > 0 ? Math.round(challengeVals.reduce((a, b) => a + b, 0) / challengeVals.length) : null;

    let improvementPct = null;
    let isImproving = false;
    if (baselineAvg && challengeAvg) {
      improvementPct = Math.round(((challengeAvg - baselineAvg) / baselineAvg) * 100);
      isImproving = lowerIsBetter ? challengeAvg < baselineAvg : challengeAvg > baselineAvg;
    }

    // Combine all data for chart
    const allData = [
      ...baselineData.map(d => ({ ...d, period: 'baseline' })),
      ...challengeData.map(d => ({ ...d, period: 'challenge' }))
    ].sort((a, b) => a.date.localeCompare(b.date));

    const modal = document.createElement('div');
    modal.id = 'metric-detail-modal';
    modal.className = 'fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-oura-bg rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg sm:mx-4 p-6 max-h-[85vh] overflow-y-auto">
        <div class="flex items-center gap-3 mb-6">
          <button onclick="Challenges.closeMetricDetailModal()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-accent hover:text-white">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <h3 class="text-lg font-bold" style="color: ${config.color}">${config.label}</h3>
        </div>

        <!-- Summary stats -->
        <div class="flex justify-around mb-6">
          <div class="text-center">
            <div class="text-2xl font-bold text-oura-muted">${baselineAvg ?? '--'}</div>
            <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Baseline</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold" style="color: ${config.color}">${challengeAvg ?? '--'}</div>
            <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Challenge</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold" style="color: ${isImproving ? '#4ade80' : improvementPct !== null ? '#f87171' : '#6b7280'}">
              ${improvementPct !== null ? (improvementPct > 0 ? '+' : '') + improvementPct + '%' : '--'}
            </div>
            <div class="text-[0.65rem] text-oura-muted uppercase tracking-wider mt-1">Change</div>
          </div>
        </div>

        <!-- Full chart -->
        <div class="bg-oura-card rounded-2xl p-4 mb-6">
          <div class="h-48"><canvas id="challenge-detail-chart"></canvas></div>
        </div>

        <!-- Daily breakdown -->
        <div class="bg-oura-card rounded-2xl p-4">
          <div class="text-xs font-semibold text-oura-muted uppercase tracking-wider mb-3">Daily Values</div>
          <div class="space-y-1.5 max-h-60 overflow-y-auto">
            ${[...allData].reverse().filter(d => d[config.field] != null).slice(0, 30).map(d => {
              const dateObj = new Date(d.date + 'T00:00:00');
              const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              const isChallenge = d.period === 'challenge';
              return `
                <div class="flex items-center justify-between py-1.5 border-b border-oura-border/50 last:border-0">
                  <span class="text-sm text-oura-muted">${dateStr}</span>
                  <span class="text-sm font-medium" style="color: ${isChallenge ? config.color : '#6b7280'}">${Math.round(d[config.field])} ${config.unit}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
    modal.addEventListener('click', (e) => { if (e.target === modal) this.closeMetricDetailModal(); });
    document.body.appendChild(modal);

    // Render chart with baseline and challenge data
    const canvas = document.getElementById('challenge-detail-chart');
    if (canvas && allData.length > 0) {
      const chartData = allData.filter(d => d[config.field] != null);
      const challengeStartIndex = chartData.findIndex(d => d.period === 'challenge');

      // Destroy previous modal chart if it exists
      if (this._metricDetailChartInstance) {
        this._metricDetailChartInstance.destroy();
        this._metricDetailChartInstance = null;
      }

      this._metricDetailChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
          labels: chartData.map(d => {
            const dt = new Date(d.date + 'T00:00:00');
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }),
          datasets: [{
            data: chartData.map(d => d[config.field]),
            borderColor: chartData.map(d => d.period === 'challenge' ? config.color : '#6b7280'),
            backgroundColor: config.color + '20',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: chartData.map(d => d.period === 'challenge' ? config.color : '#6b7280'),
            tension: 0.3,
            fill: false,
            segment: {
              borderColor: ctx => chartData[ctx.p0DataIndex]?.period === 'challenge' ? config.color : '#6b7280'
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1a1a2e',
              titleColor: '#fff',
              bodyColor: config.color,
              callbacks: {
                label: (ctx) => Math.round(ctx.parsed.y) + ' ' + config.unit
              }
            },
            annotation: challengeStartIndex > 0 ? {
              annotations: {
                line1: {
                  type: 'line',
                  xMin: challengeStartIndex,
                  xMax: challengeStartIndex,
                  borderColor: '#6c63ff',
                  borderWidth: 2,
                  borderDash: [5, 5],
                  label: {
                    display: true,
                    content: 'Challenge Start',
                    position: 'start'
                  }
                }
              }
            } : {}
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

  // Close metric detail modal
  closeMetricDetailModal() {
    // Destroy chart before removing modal
    if (this._metricDetailChartInstance) {
      this._metricDetailChartInstance.destroy();
      this._metricDetailChartInstance = null;
    }
    document.getElementById('metric-detail-modal')?.remove();
  },

  // Show details modal with habits and full metrics
  async showDetailsModal(challengeId) {
    const currentUser = await SupabaseClient.getCurrentUser();
    const challenge = await this.getChallenge(challengeId);
    const today = this.toLocalDateStr(new Date());
    const completedHabits = await this.getHabitCompletions(challengeId, currentUser.id, today);
    const habits = Protocols.getHabitsForMode(challenge.protocol, challenge.mode || 'pro');
    const participantProgress = await this.getParticipantProgress(challengeId);

    const modal = document.createElement('div');
    modal.id = 'details-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center';
    modal.innerHTML = `
      <div class="bg-oura-bg w-full sm:max-w-lg sm:rounded-2xl rounded-t-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div class="p-5 border-b border-oura-border flex items-center justify-between flex-shrink-0">
          <h3 class="text-lg font-bold">Challenge Details</h3>
          <button onclick="Challenges.closeDetailsModal()" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-oura-muted hover:text-white">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-5 space-y-6">
          <!-- Today's Habits -->
          <div>
            <h4 class="text-sm font-semibold text-oura-muted uppercase tracking-wider mb-3">Today's Habits</h4>
            <div class="space-y-2">
              ${habits.map(habit => `
                <label class="flex items-start gap-3 p-3 bg-oura-card rounded-lg cursor-pointer hover:bg-oura-subtle">
                  <input type="checkbox" ${completedHabits.includes(habit.id) ? 'checked' : ''}
                    onchange="Challenges.handleToggleHabit('${challengeId}', '${habit.id}', '${today}')"
                    class="mt-1 w-5 h-5 rounded border-oura-border text-oura-teal focus:ring-oura-teal bg-oura-border">
                  <div>
                    <p class="font-medium text-sm">${escapeHtml(habit.title)}</p>
                    ${habit.description ? `<p class="text-xs text-oura-muted">${escapeHtml(habit.description)}</p>` : ''}
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Habit Progress -->
          <div>
            <h4 class="text-sm font-semibold text-oura-muted uppercase tracking-wider mb-3">Habit Completion</h4>
            <div class="space-y-3">
              ${participantProgress.sort((a, b) => b.percentage - a.percentage).map(p => `
                <div>
                  <div class="flex justify-between mb-1">
                    <span class="text-sm font-medium">${escapeHtml(p.user.display_name || p.user.email)}</span>
                    <span class="text-sm text-oura-muted">${p.percentage}%</span>
                  </div>
                  <div class="w-full bg-oura-card rounded-full h-2">
                    <div class="bg-oura-teal h-2 rounded-full transition-all" style="width: ${p.percentage}%"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Full Comparison Charts -->
          <div>
            <h4 class="text-sm font-semibold text-oura-muted uppercase tracking-wider mb-3">Detailed Metrics</h4>
            <div id="modal-comparison-charts" class="space-y-4">
              <p class="text-oura-muted text-sm">Loading...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeDetailsModal();
    });

    // Load full comparison charts into modal
    setTimeout(() => {
      Comparison.renderForChallenge(challengeId, 'modal-comparison-charts');
    }, 100);
  },

  // Close details modal
  closeDetailsModal() {
    const modal = document.getElementById('details-modal');
    if (modal) modal.remove();
  },

  // Show settings menu (sync, delete)
  showSettingsMenu(challengeId, isCreator) {
    const modal = document.createElement('div');
    modal.id = 'settings-menu-modal';
    modal.className = 'fixed inset-0 bg-black/50 z-50 flex items-end justify-center';
    modal.innerHTML = `
      <div class="bg-oura-card rounded-t-2xl w-full max-w-md p-4 pb-8">
        <div class="w-10 h-1 bg-oura-border rounded-full mx-auto mb-4"></div>

        <button onclick="SleepSync.syncNow(); Challenges.closeSettingsMenu();"
          class="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-oura-subtle transition-colors">
          <svg class="w-5 h-5 text-oura-muted" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          <span class="text-white font-medium">Sync Sleep Data</span>
        </button>

        ${isCreator ? `
        <button onclick="Challenges.closeSettingsMenu(); Challenges.handleDeleteChallenge('${challengeId}');"
          class="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-red-900/20 transition-colors mt-1">
          <svg class="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          <span class="text-red-400 font-medium">Delete Challenge</span>
        </button>
        ` : ''}

        <button onclick="Challenges.closeSettingsMenu()"
          class="w-full p-4 mt-4 rounded-xl bg-oura-subtle text-oura-muted font-medium hover:bg-oura-border transition-colors">
          Cancel
        </button>
      </div>
    `;
    modal.addEventListener('click', (e) => { if (e.target === modal) this.closeSettingsMenu(); });
    document.body.appendChild(modal);
  },

  // Close settings menu
  closeSettingsMenu() {
    const modal = document.getElementById('settings-menu-modal');
    if (modal) modal.remove();
  },

  // Handle habit toggle
  async handleToggleHabit(challengeId, habitId, date) {
    try {
      await this.toggleHabit(challengeId, habitId, date);
    } catch (error) {
      console.error('Error toggling habit:', error);
      alert('Failed to update habit: ' + error.message);
      // Re-render to reset checkbox state
      this.renderDetail(challengeId);
    }
  },

  // Handle accept invitation
  async handleAcceptInvite(participantId) {
    try {
      await this.acceptInvitation(participantId);
      await this.renderList();
    } catch (error) {
      console.error('Error accepting invitation:', error);
      alert('Failed to accept invitation: ' + error.message);
    }
  },

  // Handle decline invitation
  async handleDeclineInvite(participantId) {
    try {
      await this.declineInvitation(participantId);
      await this.renderList();
    } catch (error) {
      console.error('Error declining invitation:', error);
      alert('Failed to decline invitation: ' + error.message);
    }
  },

  // Invite friends to an existing challenge
  async inviteFriends(challengeId, friendIds) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    if (friendIds.length === 0) return;

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    const participants = friendIds.map(friendId => ({
      challenge_id: challengeId,
      user_id: friendId,
      status: 'invited',
      invited_by: currentUser.id
    }));

    const { error } = await client
      .from('challenge_participants')
      .insert(participants);

    if (error) {
      if (error.code === '23505') {
        throw new Error('One or more friends have already been invited');
      }
      throw error;
    }
  },

  // Invite someone by email to a challenge (even if not a friend yet)
  async inviteByEmail(challengeId, email) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    // Search for user by email
    const user = await Friends.searchByEmail(email);

    if (user) {
      // User exists - add them as challenge participant
      const { error } = await client
        .from('challenge_participants')
        .insert({
          challenge_id: challengeId,
          user_id: user.id,
          status: 'invited',
          invited_by: currentUser.id
        });

      if (error) {
        if (error.code === '23505') {
          throw new Error('This person is already in the challenge');
        }
        throw error;
      }

      return { type: 'existing_user', user };
    } else {
      // User doesn't exist - create pending invite with challenge reference
      const { data, error } = await client
        .from('pending_invites')
        .insert({
          inviter_id: currentUser.id,
          invited_email: email.toLowerCase(),
          challenge_id: challengeId
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error('Invite already sent to this email');
        }
        throw error;
      }

      // Try to send invite email
      let emailSent = false;
      try {
        const res = await fetch('/api/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.toLowerCase() })
        });
        emailSent = res.ok;
      } catch (e) {
        console.error('Invite email failed:', e);
      }

      return { type: 'new_user', invite: data, emailSent };
    }
  },

  // Show invite friends modal for an existing challenge
  async showInviteFriendsModal(challengeId) {
    const challenge = await this.getChallenge(challengeId);
    const friends = await Friends.getFriends();

    // Filter out friends already in the challenge
    const existingUserIds = new Set(challenge.participants.map(p => p.user.id));
    const availableFriends = friends.filter(f => !existingUserIds.has(f.id));

    const modal = document.createElement('div');
    modal.id = 'invite-friends-modal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-oura-card rounded-2xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <h3 class="text-xl font-bold mb-4">Invite to Challenge</h3>

        <!-- Email invite section -->
        <div class="mb-6">
          <label class="block text-xs text-oura-muted font-medium uppercase tracking-wide mb-2">Invite by Email</label>
          <p class="text-oura-muted text-xs mb-3">Invite anyone - they'll automatically become your friend when they accept.</p>
          <div class="flex gap-2">
            <input type="email" id="invite-email-input" placeholder="friend@email.com"
              class="flex-1 px-4 py-3 bg-oura-subtle border border-oura-border rounded-lg text-white placeholder-neutral-600 focus:outline-none focus:border-oura-teal">
            <button type="button" id="invite-email-btn"
              class="px-4 py-3 min-h-[44px] bg-oura-teal text-gray-900 font-semibold rounded-lg hover:bg-oura-teal/90">
              Invite
            </button>
          </div>
          <p id="invite-email-status" class="text-xs mt-2 hidden"></p>
        </div>

        ${availableFriends.length > 0 ? `
          <div class="border-t border-oura-border pt-4">
            <label class="block text-xs text-oura-muted font-medium uppercase tracking-wide mb-3">Or Select Friends</label>
            <form id="invite-friends-form" class="space-y-4">
              <div class="space-y-2 max-h-48 overflow-y-auto">
                ${availableFriends.map(f => `
                  <label class="flex items-center gap-3 p-3 bg-oura-subtle rounded-lg cursor-pointer hover:bg-oura-border">
                    <input type="checkbox" name="friends" value="${f.id}"
                      class="w-5 h-5 rounded border-oura-border text-oura-teal focus:ring-oura-teal bg-oura-border">
                    <span class="font-medium">${escapeHtml(f.displayName || f.email)}</span>
                  </label>
                `).join('')}
              </div>
              <button type="submit"
                class="w-full py-3 min-h-[44px] bg-oura-teal text-gray-900 font-semibold rounded-lg hover:bg-oura-teal/90">
                Invite Selected
              </button>
            </form>
          </div>
        ` : ''}

        <button type="button" onclick="Challenges.closeInviteFriendsModal()"
          class="w-full py-3 min-h-[44px] mt-4 bg-oura-border rounded-lg hover:bg-oura-subtle">
          Close
        </button>
      </div>
    `;

    document.body.appendChild(modal);

    // Handle email invite
    const emailBtn = document.getElementById('invite-email-btn');
    const emailInput = document.getElementById('invite-email-input');
    const emailStatus = document.getElementById('invite-email-status');

    if (emailBtn && emailInput) {
      emailBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email) return;

        emailBtn.disabled = true;
        emailBtn.textContent = '...';
        emailStatus.classList.remove('hidden');
        emailStatus.className = 'text-xs mt-2 text-oura-muted';
        emailStatus.textContent = 'Sending invite...';

        try {
          const result = await this.inviteByEmail(challengeId, email);

          if (result.type === 'existing_user') {
            emailStatus.className = 'text-xs mt-2 text-green-400';
            emailStatus.textContent = `Invite sent to ${result.user.display_name || result.user.email}!`;
          } else {
            emailStatus.className = 'text-xs mt-2 text-green-400';
            emailStatus.textContent = result.emailSent
              ? `Invite email sent to ${email}! They'll join when they sign up.`
              : `Invite saved! Share the app link with ${email}.`;
          }

          emailInput.value = '';

          // Refresh challenge detail after short delay
          setTimeout(async () => {
            this.closeInviteFriendsModal();
            await this.renderDetail(challengeId);
          }, 1500);
        } catch (error) {
          console.error('Error inviting by email:', error);
          emailStatus.className = 'text-xs mt-2 text-red-400';
          emailStatus.textContent = error.message;
        }

        emailBtn.disabled = false;
        emailBtn.textContent = 'Invite';
      });

      // Allow Enter key to submit
      emailInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          emailBtn.click();
        }
      });
    }

    // Handle friends form submission
    const form = document.getElementById('invite-friends-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const checkboxes = document.querySelectorAll('#invite-friends-form input[name="friends"]:checked');
        const friendIds = Array.from(checkboxes).map(cb => cb.value);

        if (friendIds.length === 0) {
          alert('Please select at least one friend to invite.');
          return;
        }

        try {
          await this.inviteFriends(challengeId, friendIds);
          this.closeInviteFriendsModal();
          await this.renderDetail(challengeId);
        } catch (error) {
          console.error('Error inviting friends:', error);
          alert('Failed to invite friends: ' + error.message);
        }
      });
    }

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeInviteFriendsModal();
    });
  },

  // Close invite friends modal
  closeInviteFriendsModal() {
    const modal = document.getElementById('invite-friends-modal');
    if (modal) modal.remove();
  },

  // Show create challenge modal
  async showCreateModal() {
    const protocols = await Protocols.getAll();
    const friends = await Friends.getFriends();

    // Reset mode state
    Protocols._selectedMode = 'pro';

    const modal = document.createElement('div');
    modal.id = 'create-challenge-modal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-oura-card rounded-2xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <h3 class="text-xl font-bold mb-4">Create Challenge</h3>
        <form id="create-challenge-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Protocol</label>
            <select id="challenge-protocol" required
              class="w-full px-4 py-3 bg-oura-subtle border border-oura-border rounded-lg text-white">
              ${protocols.map(p => `<option value="${p.id}">${p.icon} ${p.name}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">Mode</label>
            ${Protocols.renderModeSelector(protocols[0]?.id, 'pro')}
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">Invite Friends</label>
            ${friends.length > 0 ? `
              <div class="space-y-2 max-h-40 overflow-y-auto">
                ${friends.map(f => `
                  <label class="flex items-center gap-2 p-2 bg-oura-subtle rounded">
                    <input type="checkbox" name="friends" value="${f.id}"
                      class="rounded border-oura-border text-oura-teal focus:ring-oura-teal bg-oura-border">
                    <span>${escapeHtml(f.displayName || f.email)}</span>
                  </label>
                `).join('')}
              </div>
            ` : `
              <p class="text-sm text-oura-muted">No friends to invite. Add friends first!</p>
            `}
          </div>

          <div class="flex gap-3 pt-4">
            <button type="button" onclick="Challenges.closeCreateModal()"
              class="flex-1 py-3 min-h-[44px] bg-oura-border rounded-lg hover:bg-oura-subtle">
              Cancel
            </button>
            <button type="submit"
              class="flex-1 py-3 min-h-[44px] bg-oura-teal text-gray-900 font-semibold rounded-lg hover:bg-oura-teal/90">
              Create
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Update mode selector when protocol changes
    const protocolSelect = document.getElementById('challenge-protocol');
    protocolSelect.addEventListener('change', () => {
      const modeContainer = document.getElementById('mode-selector')?.parentElement;
      if (modeContainer) {
        modeContainer.innerHTML = Protocols.renderModeSelector(protocolSelect.value, Protocols._selectedMode);
      }
    });

    // Handle form submission
    document.getElementById('create-challenge-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const protocolSelect = document.getElementById('challenge-protocol');
      const protocolId = protocolSelect.value;
      const protocolName = protocolSelect.options[protocolSelect.selectedIndex].text.replace(/^[^\s]+\s/, ''); // Remove emoji
      const name = `${protocolName} Challenge`;
      const friendCheckboxes = document.querySelectorAll('input[name="friends"]:checked');
      const friendIds = Array.from(friendCheckboxes).map(cb => cb.value);
      const mode = Protocols._selectedMode;

      try {
        const challenge = await this.create({ protocolId, name, friendIds, mode });
        this.closeCreateModal();
        // Navigate directly into the new challenge
        App.navigateTo('challenge-detail', challenge.id);
      } catch (error) {
        console.error('Error creating challenge:', error);
        alert('Failed to create challenge: ' + error.message);
      }
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeCreateModal();
    });
  },

  // Close create modal
  closeCreateModal() {
    const modal = document.getElementById('create-challenge-modal');
    if (modal) modal.remove();
  }
};

// Export for use in other modules
window.Challenges = Challenges;
