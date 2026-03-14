// Onboarding Wizard Module

const Onboarding = {
  profile: null,
  _pendingInvite: null,

  // Entry point — checks step and shows onboarding UI
  async start(profile) {
    this.profile = profile;
    const step = profile.onboarding_step || 0;

    // Show onboarding section, hide app content and bottom nav
    document.getElementById('onboarding-section').classList.remove('hidden');
    document.getElementById('app-content').classList.add('hidden');
    document.querySelector('.bottom-nav')?.classList.add('hidden');

    this.renderStep(step);
  },

  // Render a specific step
  renderStep(step) {
    const container = document.getElementById('onboarding-container');
    if (!container) return;

    container.innerHTML = '';
    container.className = 'onboarding-step-enter';

    switch (step) {
      case 0:
        this.renderNameStep(container);
        break;
      case 1:
        this.renderTokenStep(container);
        break;
      case 2:
        // Check for pending challenge invites before showing Complete
        this._checkAndRenderStep2(container);
        return; // _checkAndRenderStep2 handles its own progress bar
      default:
        this.handleComplete();
        return;
    }

    // Insert progress bar at top
    container.insertAdjacentHTML('afterbegin', this.renderProgressBar(step));

    // Trigger animation
    requestAnimationFrame(() => {
      container.classList.remove('onboarding-step-enter');
      container.classList.add('onboarding-step-active');
    });
  },

  // 4-dot horizontal progress indicator
  renderProgressBar(currentStep) {
    const steps = ['Name', 'Token', 'Done'];
    return `
      <div class="flex items-center justify-center gap-3 mb-10">
        ${steps.map((label, i) => {
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          const dotClass = isActive
            ? 'w-3 h-3 bg-oura-accent rounded-full'
            : isDone
              ? 'w-2.5 h-2.5 bg-oura-accent/50 rounded-full'
              : 'w-2.5 h-2.5 bg-oura-border rounded-full';
          return `<div class="flex flex-col items-center gap-1.5">
            <div class="${dotClass}"></div>
            <span class="text-xs ${isActive ? 'text-oura-accent' : 'text-oura-muted'}">${label}</span>
          </div>`;
        }).join('<div class="w-6 h-px bg-oura-border mb-4"></div>')}
      </div>
    `;
  },

  // Step 0 — Set Display Name
  renderNameStep(container) {
    container.innerHTML += `
      <div class="text-center mb-8">
        <svg class="w-12 h-12 mx-auto text-oura-accent mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" /></svg>
        <h2 class="text-2xl font-bold mb-2">What's Your Name?</h2>
        <p class="text-oura-muted text-sm">This is how you'll appear to friends on the leaderboard.</p>
      </div>
      <div class="bg-oura-card rounded-2xl p-6 mb-4">
        <label class="block text-xs text-oura-muted font-medium uppercase tracking-wide mb-2">Display Name</label>
        <input type="text" id="onboarding-name" placeholder="e.g. Alex"
          maxlength="30"
          class="w-full px-4 py-3.5 rounded-xl border border-oura-border bg-oura-bg text-white text-base focus:outline-none focus:border-oura-accent placeholder:text-neutral-600">
      </div>
      <button onclick="Onboarding.handleNameSave()"
        class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all mb-3">
        Continue
      </button>
      <button onclick="Onboarding.advanceStep(1)"
        class="w-full py-3 text-oura-muted text-sm hover:text-white transition-colors">
        Skip for now
      </button>
    `;
    // Auto-focus the input
    setTimeout(() => document.getElementById('onboarding-name')?.focus(), 100);
  },

  async handleNameSave() {
    const input = document.getElementById('onboarding-name');
    const name = input?.value.trim();
    if (!name) {
      this.advanceStep(1);
      return;
    }
    try {
      await Auth.updateProfile({ display_name: name });
      await this.advanceStep(1);
    } catch (error) {
      console.error('Error saving name:', error);
      await this.advanceStep(1);
    }
  },

  // Step 1 — Connect Oura Ring
  renderTokenStep(container) {
    container.innerHTML += `
      <div class="text-center mb-8">
        <svg class="w-12 h-12 mx-auto text-oura-accent mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>
        <h2 class="text-2xl font-bold mb-2">Connect Your Oura Ring</h2>
        <p class="text-oura-muted text-sm">Enter your Oura Personal Access Token to sync sleep data automatically.</p>
      </div>
      <div class="bg-oura-card rounded-2xl p-6 mb-4">
        <div class="bg-oura-subtle rounded-lg p-3 mb-4 text-sm text-oura-muted">
          <p class="font-medium text-white mb-1">How to get your token:</p>
          <ol class="list-decimal list-inside space-y-1">
            <li>Tap the button below to open Oura Cloud</li>
            <li>Sign in to your Oura account</li>
            <li>Create a new Personal Access Token</li>
            <li>Copy and paste it below</li>
          </ol>
        </div>
        <a href="https://cloud.ouraring.com/personal-access-tokens" target="_blank"
          class="flex items-center justify-center gap-2 w-full py-3 mb-4 bg-oura-subtle border border-oura-border rounded-xl text-oura-accent text-sm font-medium hover:bg-oura-border transition-colors">
          <span>Open Oura Cloud</span>
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
        </a>
        <label class="block text-xs text-oura-muted font-medium uppercase tracking-wide mb-2">Oura Personal Access Token</label>
        <input type="password" id="onboarding-token" placeholder="Paste your token here"
          class="w-full px-4 py-3.5 rounded-xl border border-oura-border bg-oura-bg text-white text-base focus:outline-none focus:border-oura-accent placeholder:text-neutral-600">
        <p id="onboarding-token-status" class="text-xs text-oura-muted mt-2"></p>
      </div>
      <button onclick="Onboarding.handleTokenSave()" id="onboarding-token-btn"
        class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all mb-3">
        Continue
      </button>
      <button onclick="Onboarding.advanceStep(2)"
        class="w-full py-3 text-oura-muted text-sm hover:text-white transition-colors">
        Skip for now
      </button>
    `;
  },

  // Step 2 — Complete
  renderCompleteStep(container) {
    container.innerHTML += `
      <div class="text-center mb-8">
        <svg class="w-12 h-12 mx-auto text-oura-accent mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.745 3.745 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" /></svg>
        <h2 class="text-2xl font-bold mb-3">You're All Set!</h2>
        <p class="text-oura-muted text-sm leading-relaxed">
          Your sleep journey starts now. Track your habits, compare with friends, and watch your heart rate improve over 30 days.
        </p>
      </div>
      <button onclick="Onboarding.handleComplete()"
        class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all">
        Go to Dashboard
      </button>
    `;
  },

  // Advance to a specific step and persist
  async advanceStep(step) {
    try {
      await Auth.updateProfile({ onboarding_step: step });
      if (this.profile) this.profile.onboarding_step = step;
      this.renderStep(step);
    } catch (error) {
      console.error('Error advancing onboarding step:', error);
    }
  },

  // Save token and kick off background sync
  async handleTokenSave() {
    const input = document.getElementById('onboarding-token');
    const statusEl = document.getElementById('onboarding-token-status');
    const btn = document.getElementById('onboarding-token-btn');
    const token = input?.value.trim();

    if (!token) {
      if (statusEl) {
        statusEl.textContent = 'Please enter your token';
        statusEl.classList.add('text-red-400');
      }
      return;
    }

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
      }

      await Auth.saveOuraToken(token);

      if (statusEl) {
        statusEl.textContent = 'Token saved! Syncing sleep data in background...';
        statusEl.classList.remove('text-oura-muted', 'text-red-400');
        statusEl.classList.add('text-oura-accent');
      }

      // Kick off background sync (silent mode)
      (typeof SleepSync !== 'undefined' ? SleepSync.syncNow({ silent: true }) : Promise.resolve()).catch(err => {
        console.error('Background sync error:', err);
      });

      // Advance to next step
      await this.advanceStep(2);
    } catch (error) {
      console.error('Error saving token:', error);
      if (statusEl) {
        statusEl.textContent = 'Failed to save token: ' + error.message;
        statusEl.classList.add('text-red-400');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Continue';
      }
    }
  },

  // Step 2 — check for pending invites, then show Join or Complete
  async _checkAndRenderStep2(container) {
    // Show brief loading while checking for invites
    container.innerHTML = '';
    container.className = 'onboarding-step-enter';

    try {
      const invite = await this._checkPendingInvites();
      if (invite) {
        this._pendingInvite = invite;
        this._renderJoinChallengeStep(container, invite);
      } else {
        this.renderCompleteStep(container);
      }
    } catch (e) {
      console.warn('[Onboarding] Invite check failed, showing complete:', e);
      this.renderCompleteStep(container);
    }

    // Add progress bar and animate
    container.insertAdjacentHTML('afterbegin', this.renderProgressBar(2));
    requestAnimationFrame(() => {
      container.classList.remove('onboarding-step-enter');
      container.classList.add('onboarding-step-active');
    });
  },

  async _checkPendingInvites() {
    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) return null;

    const { data: invites } = await SupabaseClient.client
      .from('challenge_participants')
      .select(`
        challenge_id,
        invited_by,
        challenges (id, name, start_date, protocols (name))
      `)
      .eq('user_id', currentUser.id)
      .eq('status', 'invited')
      .limit(1);

    if (!invites || invites.length === 0) return null;

    const invite = invites[0];
    const challenge = invite.challenges;
    if (!challenge) return null;

    // Skip if challenge is already over (30+ days past start)
    const endDate = new Date(challenge.start_date);
    endDate.setDate(endDate.getDate() + 30);
    if (endDate < new Date()) return null;

    // Get inviter name
    let inviterName = 'A friend';
    if (invite.invited_by) {
      const { data: inviter } = await SupabaseClient.client
        .from('profiles')
        .select('display_name, email')
        .eq('id', invite.invited_by)
        .single();
      if (inviter) {
        inviterName = inviter.display_name || inviter.email?.split('@')[0] || 'A friend';
      }
    }

    return {
      challengeId: invite.challenge_id,
      challengeName: challenge.name || 'Sleep Challenge',
      protocolName: challenge.protocols?.name || '',
      inviterName,
      startDate: challenge.start_date
    };
  },

  _renderJoinChallengeStep(container, invite) {
    const dayNumber = invite.startDate ? Challenges.getDayNumber(invite.startDate) : null;
    const dayInfo = dayNumber ? `Day ${dayNumber} of 30` : '';

    container.innerHTML += `
      <div class="text-center mb-8">
        <svg class="w-12 h-12 mx-auto text-oura-accent mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
        <h2 class="text-2xl font-bold mb-2">You've Been Invited!</h2>
        <p class="text-oura-muted text-sm">${escapeHtml(invite.inviterName)} wants you to join their challenge.</p>
      </div>
      <div class="bg-oura-card rounded-2xl p-6 mb-6 border border-oura-accent/20">
        <h3 class="text-lg font-semibold mb-1">${escapeHtml(invite.challengeName)}</h3>
        ${invite.protocolName ? `<p class="text-sm text-oura-muted mb-2">${escapeHtml(invite.protocolName)}</p>` : ''}
        ${dayInfo ? `<p class="text-xs text-oura-muted">${dayInfo}</p>` : ''}
      </div>
      <button onclick="Onboarding._handleJoinChallenge()"
        class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all mb-3">
        Join Challenge
      </button>
      <button onclick="Onboarding._pendingInvite = null; Onboarding.renderCompleteStep(document.getElementById('onboarding-container')); document.getElementById('onboarding-container').insertAdjacentHTML('afterbegin', Onboarding.renderProgressBar(2));"
        class="w-full py-3 text-oura-muted text-sm hover:text-white transition-colors">
        Maybe later
      </button>
    `;
  },

  async _handleJoinChallenge() {
    const invite = this._pendingInvite;
    if (!invite) {
      this.renderStep(2);
      return;
    }

    try {
      const currentUser = await SupabaseClient.getCurrentUser();
      const { error } = await SupabaseClient.client
        .from('challenge_participants')
        .update({ status: 'accepted', joined_at: new Date().toISOString() })
        .eq('challenge_id', invite.challengeId)
        .eq('user_id', currentUser.id);

      if (error) throw error;

      this._pendingInvite = null;

      // Show complete step
      const container = document.getElementById('onboarding-container');
      if (container) {
        container.innerHTML = '';
        container.className = 'onboarding-step-enter';
        this.renderCompleteStep(container);
        container.insertAdjacentHTML('afterbegin', this.renderProgressBar(2));
        requestAnimationFrame(() => {
          container.classList.remove('onboarding-step-enter');
          container.classList.add('onboarding-step-active');
        });
      }
    } catch (error) {
      console.error('Error joining challenge:', error);
      App.showToast('Failed to join challenge: ' + error.message, 'error');
    }
  },

  // Complete onboarding — show main app
  async handleComplete() {
    try {
      await Auth.updateProfile({ onboarding_step: 3 });
    } catch (error) {
      console.error('Error completing onboarding:', error);
    }

    // Hide onboarding, show app
    document.getElementById('onboarding-section')?.classList.add('hidden');
    document.getElementById('app-content')?.classList.remove('hidden');
    document.querySelector('.bottom-nav')?.classList.remove('hidden');

    // Navigate to dashboard
    App.navigateTo('dashboard');
  }
};

// Export for use in other modules
window.Onboarding = Onboarding;
