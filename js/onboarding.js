// Onboarding Wizard Module

const Onboarding = {
  profile: null,

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
        this.renderChallengeStep(container);
        break;
      case 3:
        this.renderFriendStep(container);
        break;
      case 4:
        this.renderCompleteStep(container);
        break;
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
    const steps = ['Name', 'Token', 'Challenge', 'Friend', 'Done'];
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

  // Step 2 — Pick a Challenge (protocol → mode → name)
  async renderChallengeStep(container) {
    container.innerHTML += `
      <div class="text-center mb-8">
        <svg class="w-12 h-12 mx-auto text-oura-accent mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 0 1-2.021 1.247m0 0A6.015 6.015 0 0 1 12 11.25a6.015 6.015 0 0 1-2.27-.475m4.54 0a6.023 6.023 0 0 0 2.021 1.247m-6.561 0a6.023 6.023 0 0 1-2.021 1.247" /></svg>
        <h2 class="text-2xl font-bold mb-2">Pick a Challenge</h2>
        <p class="text-oura-muted text-sm">Choose a protocol and start a 30-day challenge.</p>
      </div>
      <div id="onboarding-protocols" class="space-y-3 mb-6">
        <div class="text-center py-6 text-oura-muted text-sm">Loading protocols...</div>
      </div>
      <div id="onboarding-mode-selector" class="hidden mb-6">
        <label class="block text-xs text-oura-muted font-medium uppercase tracking-wide mb-3">Choose Mode</label>
        <div id="onboarding-mode-cards"></div>
      </div>
      <div id="onboarding-challenge-form" class="hidden">
        <button onclick="Onboarding.handleCreateChallenge()" id="onboarding-create-btn"
          class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all mb-3">
          Start Challenge
        </button>
      </div>
      <button onclick="Onboarding.advanceStep(3)"
        class="w-full py-3 text-oura-muted text-sm hover:text-white transition-colors">
        Skip for now
      </button>
    `;

    // Reset mode state
    Protocols._selectedMode = 'pro';

    // Load protocols
    try {
      const protocols = await Protocols.getAll();
      const protocolsContainer = document.getElementById('onboarding-protocols');
      if (!protocolsContainer) return;

      protocolsContainer.innerHTML = protocols.map(p => `
        <div onclick="Onboarding.selectProtocol('${p.id}', this)"
          class="onboarding-protocol-card bg-oura-card rounded-2xl p-5 cursor-pointer border-2 border-transparent hover:border-oura-accent/30 transition-all">
          <div class="flex items-center gap-4">
            <div class="protocol-icon w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">${Protocols.getInitials(p.name)}</div>
            <div>
              <h3 class="font-semibold">${escapeHtml(p.name)}</h3>
              <p class="text-oura-muted text-sm mt-0.5">${escapeHtml(p.description || '')}</p>
            </div>
          </div>
        </div>
      `).join('');
    } catch (error) {
      console.error('Error loading protocols:', error);
      const protocolsContainer = document.getElementById('onboarding-protocols');
      if (protocolsContainer) {
        protocolsContainer.innerHTML = '<p class="text-red-400 text-sm text-center">Failed to load protocols</p>';
      }
    }
  },

  selectedProtocolId: null,
  selectedProtocolName: null,

  async selectProtocol(protocolId, el) {
    this.selectedProtocolId = protocolId;
    // Get protocol name from the clicked element
    this.selectedProtocolName = el.querySelector('h3')?.textContent || 'Sleep';

    // Deselect all
    document.querySelectorAll('.onboarding-protocol-card').forEach(card => {
      card.classList.remove('border-oura-accent');
      card.classList.add('border-transparent');
    });

    // Select this one
    el.classList.remove('border-transparent');
    el.classList.add('border-oura-accent');

    // Show mode selector
    const modeSection = document.getElementById('onboarding-mode-selector');
    const modeCards = document.getElementById('onboarding-mode-cards');
    if (modeSection && modeCards) {
      const protocol = (await Protocols.getAll()).find(p => p.id === protocolId);
      const totalHabits = protocol?.habits?.length;
      modeCards.innerHTML = Protocols.renderModeSelector(protocolId, Protocols._selectedMode, totalHabits);
      modeSection.classList.remove('hidden');
    }

    // Show challenge name form
    document.getElementById('onboarding-challenge-form')?.classList.remove('hidden');
  },

  async handleCreateChallenge() {
    if (!this.selectedProtocolId) return;

    const name = `${this.selectedProtocolName} Challenge`;
    const btn = document.getElementById('onboarding-create-btn');
    const mode = Protocols._selectedMode;

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Creating...';
      }

      await Challenges.create({
        protocolId: this.selectedProtocolId,
        name,
        friendIds: [],
        mode
      });

      await this.advanceStep(3);
    } catch (error) {
      console.error('Error creating challenge:', error);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create Challenge';
      }
    }
  },

  // Step 2 — Add a Friend
  async renderFriendStep(container) {
    container.innerHTML += `
      <div class="text-center mb-8">
        <svg class="w-12 h-12 mx-auto text-oura-accent mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
        <h2 class="text-2xl font-bold mb-2">Add a Friend</h2>
        <p class="text-oura-muted text-sm">Invite a friend to join your challenge and compare sleep data.</p>
      </div>
      <div id="onboarding-existing-friends"></div>
      <div class="bg-oura-card rounded-2xl p-6 mb-6">
        <label class="block text-xs text-oura-muted font-medium uppercase tracking-wide mb-2">Friend's Email</label>
        <input type="email" id="onboarding-friend-email" placeholder="friend@email.com"
          class="w-full px-4 py-3.5 rounded-xl border border-oura-border bg-oura-bg text-white text-base focus:outline-none focus:border-oura-accent placeholder:text-neutral-600">
        <p id="onboarding-friend-status" class="text-xs mt-2 hidden"></p>
      </div>
      <button onclick="Onboarding.handleSendInvite()" id="onboarding-invite-btn"
        class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all mb-3">
        Send Invite
      </button>
      <button onclick="Onboarding.advanceStep(4)" id="onboarding-friend-continue"
        class="w-full py-3 text-oura-muted text-sm hover:text-white transition-colors">
        Skip for now
      </button>
    `;

    // Check for existing friends (e.g. auto-connected via invite)
    try {
      const friends = await Friends.getFriends();
      const friendsContainer = document.getElementById('onboarding-existing-friends');
      const continueBtn = document.getElementById('onboarding-friend-continue');
      if (friends.length > 0 && friendsContainer) {
        const names = friends.map(f => f.displayName || f.email).join(', ');
        friendsContainer.innerHTML = `
          <div class="bg-oura-card rounded-2xl p-5 mb-6 border border-green-500/30">
            <p class="text-green-400 text-sm font-medium mb-1">You're already connected with ${friends.length === 1 ? 'a friend' : friends.length + ' friends'}!</p>
            <p class="text-oura-muted text-xs">${names}</p>
          </div>
        `;
        if (continueBtn) {
          continueBtn.textContent = 'Continue';
          continueBtn.className = 'w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all mb-3';
        }
      }
    } catch (e) {
      console.error('Error checking existing friends:', e);
    }
  },

  async handleSendInvite() {
    const emailInput = document.getElementById('onboarding-friend-email');
    const statusEl = document.getElementById('onboarding-friend-status');
    const btn = document.getElementById('onboarding-invite-btn');
    const email = emailInput?.value.trim();

    if (!email) return;

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending...';
      }

      // Try to find user and send friend request
      const user = await Friends.searchByEmail(email);

      if (user) {
        await Friends.sendRequest(user.id);
        if (statusEl) {
          statusEl.textContent = 'Friend request sent!';
          statusEl.className = 'text-xs mt-2 text-green-400';
        }
      } else {
        // Send invite link for non-existing user
        const result = await Friends.sendInviteLink(email);
        if (statusEl) {
          if (result.emailSent) {
            statusEl.textContent = `Invite email sent to ${email}! They'll be connected when they sign up.`;
            statusEl.className = 'text-xs mt-2 text-green-400';
          } else {
            statusEl.textContent = `Invite saved but email failed: ${result.emailError}. Share the link manually.`;
            statusEl.className = 'text-xs mt-2 text-yellow-400';
          }
        }
      }

      // Advance after a brief delay so user sees success message
      setTimeout(() => this.advanceStep(4), 1000);
    } catch (error) {
      console.error('Error sending invite:', error);
      if (statusEl) {
        statusEl.textContent = error.message;
        statusEl.className = 'text-xs mt-2 text-red-400';
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send Invite';
      }
    }
  },

  // Step 3 — Complete
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

  // Complete onboarding — show main app
  async handleComplete() {
    try {
      await Auth.updateProfile({ onboarding_step: 5 });
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
