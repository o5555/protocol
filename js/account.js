// Account Module

const Account = {
  // Render account page
  async render() {
    const container = document.getElementById('account-container');
    if (!container) return;

    try {
      const currentUser = await SupabaseClient.getCurrentUser();

      if (!currentUser) {
        container.innerHTML = `
          <div class="bg-oura-card rounded-2xl p-6 text-center">
            <p class="text-oura-muted">Please sign in to view your account.</p>
          </div>
        `;
        return;
      }

      // Get user profile
      const profile = await this.getProfile(currentUser.id);
      const displayName = profile?.display_name || currentUser.email.split('@')[0];
      const hasOuraToken = !!profile?.oura_token;

      container.innerHTML = `
        <!-- Profile Section -->
        <div class="bg-oura-card rounded-2xl p-6 mb-4">
          <div class="flex items-center gap-4 mb-6">
            <div class="w-16 h-16 rounded-full bg-oura-subtle flex items-center justify-center text-2xl">
              ${displayName.charAt(0).toUpperCase()}
            </div>
            <div class="flex-1">
              <h3 class="text-lg font-semibold">${escapeHtml(displayName)}</h3>
              <p class="text-sm text-oura-muted">${escapeHtml(currentUser.email)}</p>
            </div>
          </div>

          <button onclick="Account.showEditProfileModal()"
            class="w-full py-3 min-h-[44px] bg-oura-subtle text-white rounded-lg text-sm font-medium hover:bg-oura-border transition-colors">
            Edit Profile
          </button>
        </div>

        <!-- Oura Connection -->
        <div class="bg-oura-card rounded-2xl p-6 mb-4">
          <h4 class="text-sm font-semibold text-oura-muted uppercase tracking-wider mb-4">Oura Ring</h4>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full ${hasOuraToken ? 'bg-green-500/20' : 'bg-oura-subtle'} flex items-center justify-center">
                <span class="text-lg">${hasOuraToken ? '💍' : '⚪'}</span>
              </div>
              <div>
                <p class="font-medium">${hasOuraToken ? 'Connected' : 'Not Connected'}</p>
                <p class="text-xs text-oura-muted">${hasOuraToken ? 'Syncing sleep data' : 'Connect to track sleep'}</p>
              </div>
            </div>
            <button onclick="Account.showOuraTokenModal()"
              class="px-4 py-2 min-h-[44px] ${hasOuraToken ? 'bg-oura-subtle' : 'bg-oura-teal text-gray-900'} rounded-lg text-sm font-medium">
              ${hasOuraToken ? 'Update' : 'Connect'}
            </button>
          </div>
        </div>

        <!-- Settings -->
        <div class="bg-oura-card rounded-2xl p-6 mb-4">
          <h4 class="text-sm font-semibold text-oura-muted uppercase tracking-wider mb-4">Settings</h4>
          <div class="space-y-3">
            <button onclick="SleepSync.syncNow()"
              class="w-full flex items-center justify-between p-3 bg-oura-subtle rounded-lg hover:bg-oura-border transition-colors">
              <span class="text-sm font-medium">Sync Sleep Data</span>
              <svg class="w-5 h-5 text-oura-muted" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Sign Out -->
        <button onclick="Account.signOut()"
          class="w-full py-3 min-h-[44px] bg-red-500/10 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/20 transition-colors">
          Sign Out
        </button>
      `;
    } catch (error) {
      console.error('Error rendering account:', error);
      container.innerHTML = `
        <div class="bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p class="text-red-400">Failed to load account: ${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  },

  // Get user profile
  async getProfile(userId) {
    const client = SupabaseClient.client;
    if (!client) return null;

    const { data, error } = await client
      .from('profiles')
      .select('display_name, oura_token')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
    return data;
  },

  // Show edit profile modal
  async showEditProfileModal() {
    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) return;

    const profile = await this.getProfile(currentUser.id);
    const displayName = profile?.display_name || '';

    const modal = document.createElement('div');
    modal.id = 'edit-profile-modal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-oura-card rounded-2xl p-6 w-full max-w-md mx-4">
        <h3 class="text-xl font-bold mb-4">Edit Profile</h3>
        <form id="edit-profile-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Display Name</label>
            <input type="text" id="display-name-input" value="${escapeHtml(displayName)}" placeholder="Your name"
              class="w-full px-4 py-3 bg-oura-subtle border border-oura-border rounded-lg text-white placeholder-neutral-600 focus:outline-none focus:border-oura-teal">
          </div>
          <div class="flex gap-3 pt-4">
            <button type="button" onclick="Account.closeEditProfileModal()"
              class="flex-1 py-3 min-h-[44px] bg-oura-border rounded-lg hover:bg-oura-subtle">
              Cancel
            </button>
            <button type="submit"
              class="flex-1 py-3 min-h-[44px] bg-oura-teal text-gray-900 font-semibold rounded-lg hover:bg-oura-teal/90">
              Save
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Handle form submission
    document.getElementById('edit-profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const newDisplayName = document.getElementById('display-name-input').value.trim();

      try {
        await this.updateProfile({ display_name: newDisplayName || null });
        this.closeEditProfileModal();
        this.render();
      } catch (error) {
        console.error('Error updating profile:', error);
        alert('Failed to update profile: ' + error.message);
      }
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeEditProfileModal();
    });
  },

  // Close edit profile modal
  closeEditProfileModal() {
    const modal = document.getElementById('edit-profile-modal');
    if (modal) modal.remove();
  },

  // Update user profile
  async updateProfile(updates) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');

    const { error } = await client
      .from('profiles')
      .update(updates)
      .eq('id', currentUser.id);

    if (error) throw error;
  },

  // Show Oura token modal
  async showOuraTokenModal() {
    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) return;

    const profile = await this.getProfile(currentUser.id);
    const hasToken = !!profile?.oura_token;

    const modal = document.createElement('div');
    modal.id = 'oura-token-modal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-oura-card rounded-2xl p-6 w-full max-w-md mx-4">
        <h3 class="text-xl font-bold mb-2">${hasToken ? 'Update' : 'Connect'} Oura Ring</h3>
        <p class="text-sm text-oura-muted mb-4">Enter your Oura Personal Access Token to sync sleep data.</p>

        <div class="bg-oura-subtle rounded-lg p-3 mb-4 text-xs text-oura-muted">
          <p class="font-medium text-white mb-1">How to get your token:</p>
          <ol class="list-decimal list-inside space-y-1">
            <li>Go to <a href="https://cloud.ouraring.com/personal-access-tokens" target="_blank" class="text-oura-teal underline">cloud.ouraring.com</a></li>
            <li>Sign in to your Oura account</li>
            <li>Create a new Personal Access Token</li>
            <li>Copy and paste it below</li>
          </ol>
        </div>

        <form id="oura-token-form" class="space-y-4">
          <div>
            <input type="password" id="oura-token-input" placeholder="Paste your token here"
              class="w-full px-4 py-3 bg-oura-subtle border border-oura-border rounded-lg text-white placeholder-neutral-600 focus:outline-none focus:border-oura-teal">
          </div>
          <p id="oura-token-status" class="text-xs hidden"></p>
          <div class="flex gap-3">
            <button type="button" onclick="Account.closeOuraTokenModal()"
              class="flex-1 py-3 min-h-[44px] bg-oura-border rounded-lg hover:bg-oura-subtle">
              Cancel
            </button>
            <button type="submit"
              class="flex-1 py-3 min-h-[44px] bg-oura-teal text-gray-900 font-semibold rounded-lg hover:bg-oura-teal/90">
              Save
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Handle form submission
    document.getElementById('oura-token-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('oura-token-input').value.trim();
      const statusEl = document.getElementById('oura-token-status');

      if (!token) {
        statusEl.className = 'text-xs text-red-400';
        statusEl.textContent = 'Please enter a token';
        statusEl.classList.remove('hidden');
        return;
      }

      try {
        statusEl.className = 'text-xs text-oura-muted';
        statusEl.textContent = 'Saving...';
        statusEl.classList.remove('hidden');

        await this.updateProfile({ oura_token: token });

        statusEl.className = 'text-xs text-green-400';
        statusEl.textContent = 'Token saved successfully!';

        setTimeout(() => {
          this.closeOuraTokenModal();
          this.render();
        }, 1000);
      } catch (error) {
        console.error('Error saving token:', error);
        statusEl.className = 'text-xs text-red-400';
        statusEl.textContent = 'Failed to save token: ' + error.message;
      }
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeOuraTokenModal();
    });
  },

  // Close Oura token modal
  closeOuraTokenModal() {
    const modal = document.getElementById('oura-token-modal');
    if (modal) modal.remove();
  },

  // Sign out
  async signOut() {
    if (!confirm('Are you sure you want to sign out?')) return;

    try {
      await Auth.signOut();
      // Reload page to show auth section
      window.location.reload();
    } catch (error) {
      console.error('Error signing out:', error);
      alert('Failed to sign out: ' + error.message);
    }
  }
};

// Export for use in other modules
window.Account = Account;
