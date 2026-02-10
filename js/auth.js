// Authentication Module - Magic Link Flow

const Auth = {
  // Send magic link to email
  async sendMagicLink(email) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin
      }
    });

    if (error) throw error;
    return data;
  },

  // Sign in with email and password
  async signInWithPassword(email, password) {
    const client = SupabaseClient.client;
    if (!client) throw new Error('Supabase not initialized');

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
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

    // Clear any local storage items
    localStorage.removeItem('oura_token');
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
      console.log('Oura token migrated to Supabase');
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

    // Check for magic link callback in URL
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const queryParams = new URLSearchParams(window.location.search);

    if (hashParams.get('access_token') || queryParams.get('code')) {
      // Handle the auth callback
      const { data, error } = await client.auth.getSession();
      if (error) {
        console.error('Auth callback error:', error);
      } else if (data.session) {
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
        // Try to migrate local token
        await this.migrateLocalToken();
      }
    }

    // Set up auth state change listener
    SupabaseClient.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event);

      if (event === 'SIGNED_IN') {
        await this.migrateLocalToken();
        this.updateUI(session?.user);
      } else if (event === 'SIGNED_OUT') {
        this.updateUI(null);
      }
    });

    // Initial UI update
    const user = await SupabaseClient.getCurrentUser();
    this.updateUI(user);
  },

  // Switch between magic link and password auth tabs
  switchAuthTab(tab) {
    const magicForm = document.getElementById('magic-link-form');
    const passwordForm = document.getElementById('password-form');
    const tabMagic = document.getElementById('tab-magic');
    const tabPassword = document.getElementById('tab-password');

    if (tab === 'magic') {
      magicForm.classList.remove('hidden');
      passwordForm.classList.add('hidden');
      tabMagic.classList.add('bg-oura-border', 'text-white');
      tabMagic.classList.remove('text-oura-muted');
      tabPassword.classList.remove('bg-oura-border', 'text-white');
      tabPassword.classList.add('text-oura-muted');
    } else {
      magicForm.classList.add('hidden');
      passwordForm.classList.remove('hidden');
      tabPassword.classList.add('bg-oura-border', 'text-white');
      tabPassword.classList.remove('text-oura-muted');
      tabMagic.classList.remove('bg-oura-border', 'text-white');
      tabMagic.classList.add('text-oura-muted');
    }
  },

  // Update UI based on auth state
  updateUI(user) {
    const authSection = document.getElementById('auth-section');
    const appContent = document.getElementById('app-content');

    if (user) {
      // User is logged in — hide auth, check onboarding before showing app
      if (authSection) authSection.classList.add('hidden');

      // Check onboarding state before showing app
      this.checkOnboarding(user);

      // Dispatch custom event for other modules
      window.dispatchEvent(new CustomEvent('userLoggedIn', { detail: { user } }));
    } else {
      // User is not logged in
      if (authSection) authSection.classList.remove('hidden');
      if (appContent) appContent.classList.add('hidden');
      // Also hide onboarding section
      const onboardingSection = document.getElementById('onboarding-section');
      if (onboardingSection) onboardingSection.classList.add('hidden');

      // Dispatch custom event for other modules
      window.dispatchEvent(new CustomEvent('userLoggedOut'));
    }
  },

  // Check onboarding state and route accordingly
  async checkOnboarding(user) {
    try {
      const profile = await this.getProfile();
      if (!profile || profile.onboarding_step < 4) {
        // No profile yet or onboarding incomplete — show onboarding flow
        Onboarding.start(profile || { onboarding_step: 0 });
      } else {
        // Onboarding complete — show main app
        const appContent = document.getElementById('app-content');
        if (appContent) appContent.classList.remove('hidden');
        const bottomNav = document.querySelector('.bottom-nav');
        if (bottomNav) bottomNav.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error checking onboarding:', error);
      // Fallback: show onboarding to avoid bypassing it
      Onboarding.start({ onboarding_step: 0 });
    }
  }
};

// UI Event Handlers
document.addEventListener('DOMContentLoaded', () => {
  // Magic link form submission
  const magicLinkForm = document.getElementById('magic-link-form');
  if (magicLinkForm) {
    magicLinkForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const emailInput = document.getElementById('auth-email');
      const submitBtn = document.getElementById('auth-submit');
      const messageEl = document.getElementById('auth-message');

      const email = emailInput.value.trim();
      if (!email) return;

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        await Auth.sendMagicLink(email);

        messageEl.textContent = 'Check your email for the magic link!';
        messageEl.className = 'text-sm text-green-400 mt-2';
        emailInput.value = '';
      } catch (error) {
        messageEl.textContent = error.message || 'Failed to send magic link';
        messageEl.className = 'text-sm text-red-400 mt-2';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Magic Link';
      }
    });
  }

  // Password form submission
  const passwordForm = document.getElementById('password-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const emailInput = document.getElementById('auth-email-pw');
      const passwordInput = document.getElementById('auth-password');
      const submitBtn = document.getElementById('auth-submit-pw');
      const messageEl = document.getElementById('auth-message-pw');

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';

        await Auth.signInWithPassword(emailInput.value.trim(), passwordInput.value);
      } catch (error) {
        messageEl.textContent = error.message || 'Failed to sign in';
        messageEl.className = 'text-sm text-red-400 mt-2';
        messageEl.classList.remove('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });
  }

  // Initialize auth
  Auth.init();
});

// Export for use in other modules
window.Auth = Auth;
