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
        this.renderTokenStep(container);
        break;
      case 1:
        this.renderChallengeStep(container);
        break;
      case 2:
        this.renderFriendStep(container);
        break;
      case 3:
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
    const steps = ['Token', 'Challenge', 'Friend', 'Done'];
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
            <span class="text-[10px] ${isActive ? 'text-oura-accent' : 'text-oura-muted'}">${label}</span>
          </div>`;
        }).join('<div class="w-6 h-px bg-oura-border mb-4"></div>')}
      </div>
    `;
  },

  // Step 0 — Connect Oura Ring
  renderTokenStep(container) {
    container.innerHTML += `
      <div class="text-center mb-8">
        <div class="text-5xl mb-4">&#x1F48D;</div>
        <h2 class="text-2xl font-bold mb-2">Connect Your Oura Ring</h2>
        <p class="text-oura-muted text-sm">Enter your Oura Personal Access Token to sync sleep data automatically.</p>
      </div>
      <div class="bg-oura-card rounded-2xl p-6 mb-6">
        <label class="block text-xs text-oura-muted font-medium uppercase tracking-wide mb-2">Oura Personal Access Token</label>
        <input type="password" id="onboarding-token" placeholder="Paste your token here"
          class="w-full px-4 py-3.5 rounded-xl border border-oura-border bg-oura-bg text-white text-sm focus:outline-none focus:border-oura-accent placeholder:text-neutral-600">
        <p id="onboarding-token-status" class="text-xs text-oura-muted mt-2"></p>
      </div>
      <button onclick="Onboarding.handleTokenSave()" id="onboarding-token-btn"
        class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all mb-3">
        Continue
      </button>
      <button onclick="Onboarding.advanceStep(1)"
        class="w-full py-3 text-oura-muted text-sm hover:text-white transition-colors">
        Skip for now
      </button>
    `;
  },

  // Step 1 — Pick a Challenge (protocol → mode → name)
  async renderChallengeStep(container) {
    container.innerHTML += `
      <div class="text-center mb-8">
        <div class="text-5xl mb-4">&#x1F3C6;</div>
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
      <button onclick="Onboarding.advanceStep(2)"
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
            <span class="text-3xl">${p.icon || '&#x1F4CB;'}</span>
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

  selectProtocol(protocolId, el) {
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
      modeCards.innerHTML = Protocols.renderModeSelector(protocolId, Protocols._selectedMode);
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

      await this.advanceStep(2);
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
        <div class="text-5xl mb-4">&#x1F91D;</div>
        <h2 class="text-2xl font-bold mb-2">Add a Friend</h2>
        <p class="text-oura-muted text-sm">Invite a friend to join your challenge and compare sleep data.</p>
      </div>
      <div id="onboarding-existing-friends"></div>
      <div class="bg-oura-card rounded-2xl p-6 mb-6">
        <label class="block text-xs text-oura-muted font-medium uppercase tracking-wide mb-2">Friend's Email</label>
        <input type="email" id="onboarding-friend-email" placeholder="friend@email.com"
          class="w-full px-4 py-3.5 rounded-xl border border-oura-border bg-oura-bg text-white text-sm focus:outline-none focus:border-oura-accent placeholder:text-neutral-600">
        <p id="onboarding-friend-status" class="text-xs mt-2 hidden"></p>
      </div>
      <button onclick="Onboarding.handleSendInvite()" id="onboarding-invite-btn"
        class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all mb-3">
        Send Invite
      </button>
      <button onclick="Onboarding.advanceStep(3)" id="onboarding-friend-continue"
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
      setTimeout(() => this.advanceStep(3), 1000);
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
        <div class="text-6xl mb-4">&#x1F389;</div>
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
      SleepSync.syncNow({ silent: true }).catch(err => {
        console.error('Background sync error:', err);
      });

      // Advance to next step
      await this.advanceStep(1);
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
      await Auth.updateProfile({ onboarding_step: 4 });
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
