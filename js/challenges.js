// Challenges Module

const Challenges = {
  // Create a new challenge
  async create({ protocolId, name, friendIds, mode }) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    const startDate = new Date();
    const endDate = new Date();
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
        status: 'invited'
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
      .order('created_at', { foreignTable: 'challenges', ascending: false });

    if (error) throw error;

    return data.map(p => ({
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
          user:profiles(id, email, display_name)
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

  // Toggle habit completion
  async toggleHabit(challengeId, habitId, date) {
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
      .single();

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
  getDayNumber(startDate) {
    const start = this.parseLocalDate(startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff + 1);
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
                      <p class="font-semibold">${inv.name} ${Protocols.renderModeBadge(inv.mode || 'pro')}</p>
                      <p class="text-sm text-oura-muted">${inv.protocol.icon} ${inv.protocol.name}</p>
                      <p class="text-sm text-oura-muted">From: ${inv.creator.display_name || inv.creator.email}</p>
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
                      <p class="font-semibold">${challenge.name} ${Protocols.renderModeBadge(challenge.mode || 'pro')}</p>
                      <p class="text-sm text-oura-muted">${challenge.protocol.icon} ${challenge.protocol.name}</p>
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
          <p class="text-red-400">Failed to load challenges: ${error.message}</p>
        </div>
      `;
    }
  },

  // Render challenge detail page
  async renderDetail(challengeId) {
    const container = document.getElementById('challenge-detail-container');
    if (!container) return;

    try {
      const currentUser = await SupabaseClient.getCurrentUser();
      const challenge = await this.getChallenge(challengeId);
      const now = new Date();
      const today = this.toLocalDateStr(now);
      const completedHabits = await this.getHabitCompletions(challengeId, currentUser.id, today);
      const participantProgress = await this.getParticipantProgress(challengeId);

      // Filter habits based on challenge mode
      const habits = Protocols.getHabitsForMode(challenge.protocol, challenge.mode || 'pro');

      // Store challengeId for sync refresh
      container.dataset.challengeId = challengeId;

      container.innerHTML = `
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <button onclick="App.navigateTo('challenges')" class="min-h-[44px] inline-flex items-center text-oura-muted hover:text-white">
            &larr; Back
          </button>
          <div class="text-right">
            <p class="text-oura-teal font-semibold">Day ${challenge.dayNumber} of 30</p>
            <p class="text-xs text-oura-muted">${challenge.daysRemaining} days left</p>
          </div>
        </div>

        <div class="mb-5">
          <div class="flex items-center gap-3 mb-1">
            <h2 class="text-xl font-bold">${challenge.name}</h2>
            ${Protocols.renderModeBadge(challenge.mode || 'pro')}
          </div>
          <p class="text-oura-muted text-sm">${challenge.protocol.icon} ${challenge.protocol.name}</p>
        </div>

        <!-- Sleep Performance (TOP — most important) -->
        <div class="bg-oura-card rounded-2xl p-5 mb-5">
          <h3 class="text-lg font-semibold mb-4">Sleep Performance</h3>
          <div id="comparison-charts">
            <p class="text-oura-muted text-sm">Loading sleep data...</p>
          </div>
        </div>

        <!-- Today's Checklist -->
        <div class="bg-oura-card rounded-2xl p-5 mb-5">
          <h3 class="text-lg font-semibold mb-4">Today's Habits</h3>
          <div class="space-y-3">
            ${habits.map(habit => `
              <label class="flex items-start gap-3 p-3 bg-oura-subtle rounded-lg cursor-pointer hover:bg-oura-border">
                <input type="checkbox" ${completedHabits.includes(habit.id) ? 'checked' : ''}
                  onchange="Challenges.handleToggleHabit('${challengeId}', '${habit.id}', '${today}')"
                  class="mt-1 w-5 h-5 rounded border-oura-border text-oura-teal focus:ring-oura-teal bg-oura-border">
                <div>
                  <p class="font-medium">${habit.title}</p>
                  ${habit.description ? `<p class="text-sm text-oura-muted">${habit.description}</p>` : ''}
                </div>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Participant Habit Progress -->
        <div class="bg-oura-card rounded-2xl p-5 mb-5">
          <h3 class="text-lg font-semibold mb-4">Habit Progress</h3>
          <div class="space-y-4">
            ${participantProgress.sort((a, b) => b.percentage - a.percentage).map(p => `
              <div>
                <div class="flex justify-between mb-1">
                  <span class="text-sm font-medium">${p.user.display_name || p.user.email}</span>
                  <span class="text-sm text-oura-muted">${p.percentage}%</span>
                </div>
                <div class="w-full bg-oura-subtle rounded-full h-2">
                  <div class="bg-oura-teal h-2 rounded-full transition-all" style="width: ${p.percentage}%"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      // Load comparison charts
      if (window.Comparison) {
        Comparison.renderForChallenge(challengeId);
      }
    } catch (error) {
      console.error('Error rendering challenge detail:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p class="text-red-400">Failed to load challenge: ${error.message}</p>
        </div>
      `;
    }
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
                    <span>${f.displayName || f.email}</span>
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
        await this.create({ protocolId, name, friendIds, mode });
        this.closeCreateModal();
        await this.renderList();
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
