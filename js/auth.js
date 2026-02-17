// Authentication Module - OTP Code Flow

const Auth = {
  _pendingEmail: null,

  // Send OTP code to email
  async sendOtp(email) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true
      }
    });

    if (error) throw error;
    this._pendingEmail = email;
    return data;
  },

  // Verify OTP code
  async verifyOtp(email, token) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client.auth.verifyOtp({
      email,
      token,
      type: 'email'
    });

    if (error) throw error;
    return data;
  },

  // Sign out current user
  async signOut() {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { error } = await client.auth.signOut();
    if (error) throw error;

    localStorage.removeItem('oura_token');
  },

  // Show email step, hide code step
  showEmailStep() {
    document.getElementById('auth-step-email').classList.remove('hidden');
    document.getElementById('auth-step-code').classList.add('hidden');
    document.getElementById('auth-message').className = 'hidden';
  },

  // Show code step, hide email step
  showCodeStep(email) {
    document.getElementById('auth-step-email').classList.add('hidden');
    document.getElementById('auth-step-code').classList.remove('hidden');
    document.getElementById('auth-code-email').textContent = email;
    document.getElementById('auth-code-message').className = 'hidden';

    // Focus the first OTP input
    const firstInput = document.querySelector('#otp-inputs .otp-digit');
    if (firstInput) firstInput.focus();
  },

  // Resend OTP code
  async resendCode() {
    if (!this._pendingEmail) return;
    const btn = document.getElementById('auth-resend-btn');
    const msgEl = document.getElementById('auth-code-message');

    try {
      btn.disabled = true;
      btn.textContent = 'Sending...';
      await this.sendOtp(this._pendingEmail);
      msgEl.textContent = 'New code sent!';
      msgEl.className = 'text-sm text-green-400 mt-2';
    } catch (error) {
      msgEl.textContent = 'Failed to resend. Try again.';
      msgEl.className = 'text-sm text-red-400 mt-2';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Resend code';
    }
  },

  // Get current user profile
  async getProfile() {
    const client = SupabaseClient.client;
    if (!client) return null;

    const user = await SupabaseClient.getCurrentUser();
    if (!user) return null;

    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }

    return data;
  },

  // Update user profile
  async updateProfile(updates) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const user = await SupabaseClient.getCurrentUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await client
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Save Oura token to profile
  async saveOuraToken(token) {
    return this.updateProfile({ oura_token: token });
  },

  // Get Oura token from profile
  async getOuraToken() {
    const profile = await this.getProfile();
    return profile?.oura_token || null;
  },

  // Migrate token from localStorage to Supabase
  async migrateLocalToken() {
    const localToken = localStorage.getItem('oura_token');
    if (!localToken) return false;

    const user = await SupabaseClient.getCurrentUser();
    if (!user) return false;

    try {
      await this.saveOuraToken(localToken);
      localStorage.removeItem('oura_token');
      return true;
    } catch (error) {
      console.error('Failed to migrate token:', error);
      return false;
    }
  },

  // Initialize auth state and handle redirects
  async init() {
    const client = SupabaseClient.client;
    if (!client) return;

    // Handle magic link callback in URL (for backwards compatibility)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const queryParams = new URLSearchParams(window.location.search);

    if (hashParams.get('access_token') || queryParams.get('code')) {
      const { data, error } = await client.auth.getSession();
      if (error) {
        console.error('Auth callback error:', error);
      } else if (data.session) {
        window.history.replaceState({}, document.title, window.location.pathname);
        await this.migrateLocalToken();
      }
    }

    // Set up auth state change listener
    SupabaseClient.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN') {
        if (typeof Cache !== 'undefined') Cache.clearAll();
        localStorage.removeItem('app_nav_state');
        await this.migrateLocalToken();
        this.updateUI(session?.user);
      } else if (event === 'SIGNED_OUT') {
        if (typeof Cache !== 'undefined') Cache.clearAll();
        localStorage.removeItem('app_nav_state');
        this.updateUI(null);
      }
    });

    // Initial UI update
    const user = await SupabaseClient.getCurrentUser();
    this.updateUI(user);
  },

  // Update UI based on auth state
  updateUI(user) {
    const authSection = document.getElementById('auth-section');
    const appContent = document.getElementById('app-content');

    if (user) {
      if (authSection) authSection.classList.add('hidden');
      this.checkOnboarding(user);
      window.dispatchEvent(new CustomEvent('userLoggedIn', { detail: { user } }));
    } else {
      if (authSection) authSection.classList.remove('hidden');
      if (appContent) appContent.classList.add('hidden');
      const onboardingSection = document.getElementById('onboarding-section');
      if (onboardingSection) onboardingSection.classList.add('hidden');
      window.dispatchEvent(new CustomEvent('userLoggedOut'));
    }
  },

  // Check onboarding state and route accordingly
  async checkOnboarding(user) {
    try {
      const profile = await this.getProfile();
      if (!profile || profile.onboarding_step < 5) {
        Onboarding.start(profile || { onboarding_step: 0 });
      } else {
        const appContent = document.getElementById('app-content');
        if (appContent) appContent.classList.remove('hidden');
        const bottomNav = document.querySelector('.bottom-nav');
        if (bottomNav) bottomNav.classList.remove('hidden');
        // Always start on dashboard after sign-in
        if (typeof App !== 'undefined' && App.navigateTo) {
          App.navigateTo('dashboard');
        }
      }
    } catch (error) {
      console.error('Error checking onboarding:', error);
      Onboarding.start({ onboarding_step: 0 });
    }
  }
};

// UI Event Handlers
document.addEventListener('DOMContentLoaded', () => {
  // Step 1: Email form - send OTP
  const emailForm = document.getElementById('otp-email-form');
  if (emailForm) {
    emailForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const emailInput = document.getElementById('auth-email');
      const submitBtn = document.getElementById('auth-submit');
      const messageEl = document.getElementById('auth-message');

      const email = emailInput.value.trim();
      if (!email) return;

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending code...';
        messageEl.className = 'hidden';

        // Clear any existing session
        try {
          const client = SupabaseClient.client;
          if (client) await client.auth.signOut({ scope: 'local' });
        } catch (_) { /* ignore */ }

        await Auth.sendOtp(email);
        Auth.showCodeStep(email);
      } catch (error) {
        let msg = 'Failed to send code. Please try again.';
        if (typeof error === 'object' && error !== null) {
          const extracted = error.message || error.error_description || error.msg || '';
          if (extracted && extracted !== '{}') msg = extracted;
        }
        messageEl.textContent = msg;
        messageEl.className = 'text-sm text-red-400 mt-2';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue';
      }
    });
  }

  // Step 2: Code form - verify OTP
  const codeForm = document.getElementById('otp-code-form');
  if (codeForm) {
    codeForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const digits = document.querySelectorAll('#otp-inputs .otp-digit');
      const code = Array.from(digits).map(d => d.value).join('');
      const verifyBtn = document.getElementById('auth-verify-btn');
      const messageEl = document.getElementById('auth-code-message');

      if (code.length !== 6) {
        messageEl.textContent = 'Please enter all 6 digits';
        messageEl.className = 'text-sm text-red-400 mt-2';
        return;
      }

      try {
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';
        messageEl.className = 'hidden';

        await Auth.verifyOtp(Auth._pendingEmail, code);
        // Auth state change listener will handle the rest
      } catch (error) {
        let msg = 'Invalid code. Please try again.';
        if (typeof error === 'object' && error !== null) {
          const extracted = error.message || error.error_description || error.msg || '';
          if (extracted && extracted !== '{}') msg = extracted;
        }
        messageEl.textContent = msg;
        messageEl.className = 'text-sm text-red-400 mt-2';
        // Clear inputs on error
        digits.forEach(d => { d.value = ''; });
        digits[0].focus();
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify';
      }
    });

    // OTP digit input behavior: auto-advance, paste support
    const digits = document.querySelectorAll('#otp-inputs .otp-digit');
    digits.forEach((input, i) => {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val.charAt(0) || '';
        if (val && i < digits.length - 1) {
          digits[i + 1].focus();
        }
        // Auto-submit when all 6 digits filled
        if (i === digits.length - 1 && val) {
          const code = Array.from(digits).map(d => d.value).join('');
          if (code.length === 6) codeForm.requestSubmit();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && i > 0) {
          digits[i - 1].focus();
        }
      });

      // Handle paste of full code
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '');
        if (pasted.length >= 6) {
          digits.forEach((d, j) => { d.value = pasted.charAt(j) || ''; });
          digits[5].focus();
          // Auto-submit
          codeForm.requestSubmit();
        }
      });
    });
  }

  // Initialize auth
  Auth.init();
});

// Export for use in other modules
window.Auth = Auth;
