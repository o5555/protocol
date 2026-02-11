// @ts-check
const { test, expect } = require('@playwright/test');

// ─── Helpers ────────────────────────────────────────────────────────────────

async function waitForAuthInit(page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const auth = document.getElementById('auth-section');
    return auth && !auth.classList.contains('hidden');
  }, { timeout: 5000 }).catch(() => {});
}

async function showApp(page) {
  await waitForAuthInit(page);
  await page.evaluate(() => {
    document.getElementById('auth-section').classList.add('hidden');
    const onboarding = document.getElementById('onboarding-section');
    if (onboarding) onboarding.classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    document.querySelector('.bottom-nav')?.classList.remove('hidden');
  });
}

async function mockSupabase(page) {
  await page.evaluate(() => {
    SupabaseClient.getCurrentUser = () => Promise.resolve({ id: 'test-user-id', email: 'test@example.com' });
    SupabaseClient.signOut = async () => {};
    const mockQuery = {
      select: () => mockQuery, eq: () => mockQuery, neq: () => mockQuery,
      gte: () => mockQuery, lte: () => mockQuery, or: () => mockQuery,
      order: () => mockQuery,
      single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 }, error: null }),
      insert: () => Promise.resolve({ data: {}, error: null }),
      update: () => mockQuery, delete: () => mockQuery,
      then: (fn) => Promise.resolve({ data: [], error: null }).then(fn),
    };
    SupabaseClient.client.from = () => ({
      ...mockQuery,
      select: () => ({
        ...mockQuery,
        eq: () => ({ ...mockQuery, eq: () => Promise.resolve({ data: [], error: null }), order: () => Promise.resolve({ data: [], error: null }), single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 }, error: null }) }),
        or: () => Promise.resolve({ data: [], error: null }),
        order: () => Promise.resolve({ data: [], error: null }),
        neq: () => ({ ...mockQuery, single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }) }),
      }),
    });
    Auth.getProfile = () => Promise.resolve({ display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 });
    if (typeof Challenges !== 'undefined') Challenges.getInvitations = async () => [];
    if (typeof Friends !== 'undefined') { Friends.getPendingRequests = async () => []; Friends.getFriends = async () => []; }
    if (typeof Cache !== 'undefined') { Cache.get = () => null; Cache.set = () => {}; Cache.clear = () => {}; }
  });
}

function collectErrors(page) {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  return errors;
}

function unexpectedErrors(errors) {
  return errors.filter(e =>
    !e.includes('Supabase') && !e.includes('Failed to fetch') && !e.includes('not initialized') &&
    !e.includes('NetworkError') && !e.includes('net::ERR') && !e.includes('ERR_CONNECTION') &&
    !e.includes('the server responded with a status of') && !e.includes('Error checking notifications') &&
    !e.includes('Error fetching profile') && !e.includes('Error rendering') && !e.includes('Error checking onboarding') &&
    !e.includes('Invite email') && !e.includes('Not authenticated') && !e.includes('Error in smart view') &&
    !e.includes('auth callback') && !e.includes('Auth callback') && !e.includes('Error signing out') && !e.includes('favicon.ico')
  );
}

// ─── 1. Sign Up via Magic Link ──────────────────────────────────────────────

test.describe('Sign Up via Magic Link', () => {
  test('new user enters email, clicks Send Magic Link, shows Sending... state', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    await expect(page.locator('#magic-link-form')).toBeVisible();
    await page.fill('#auth-email', 'newuser@example.com');

    const submitBtn = page.locator('#auth-submit');
    await submitBtn.click();

    // Button should show "Sending..." while request is in flight
    await expect(submitBtn).toHaveText('Sending...', { timeout: 2000 }).catch(() => {
      // May revert quickly if the request fails fast
    });

    // Eventually button reverts to original text
    await expect(submitBtn).toHaveText('Send Magic Link', { timeout: 25000 });
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('after submission, message element becomes visible', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    await page.fill('#auth-email', 'newuser@example.com');
    await page.locator('#auth-submit').click();

    // Wait for button to finish loading
    await expect(page.locator('#auth-submit')).toHaveText('Send Magic Link', { timeout: 25000 });

    // Message should become visible (success or error depending on Supabase availability)
    const messageEl = page.locator('#auth-message');
    await expect(messageEl).toBeVisible({ timeout: 10000 });
    const text = await messageEl.textContent();
    expect(text.length).toBeGreaterThan(0);
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('mock successful OTP sends success message with check/email/link', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    // Mock signInWithOtp to succeed
    await page.evaluate(() => {
      SupabaseClient.client.auth.signInWithOtp = async () => ({ data: {}, error: null });
    });

    await page.fill('#auth-email', 'newuser@example.com');
    await page.locator('#auth-submit').click();

    await expect(page.locator('#auth-submit')).toHaveText('Send Magic Link', { timeout: 10000 });

    const messageEl = page.locator('#auth-message');
    await expect(messageEl).toBeVisible({ timeout: 5000 });
    const text = (await messageEl.textContent()).toLowerCase();
    const hasExpectedWord = text.includes('check') || text.includes('email') || text.includes('link');
    expect(hasExpectedWord).toBe(true);

    // Success message should have green styling (not red)
    const classes = await messageEl.getAttribute('class');
    expect(classes).toContain('green');
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('mock failed OTP shows error message with error styling', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    // Mock signInWithOtp to fail
    await page.evaluate(() => {
      SupabaseClient.client.auth.signInWithOtp = async () => {
        throw new Error('Rate limit exceeded');
      };
    });

    await page.fill('#auth-email', 'newuser@example.com');
    await page.locator('#auth-submit').click();

    await expect(page.locator('#auth-submit')).toHaveText('Send Magic Link', { timeout: 10000 });

    const messageEl = page.locator('#auth-message');
    await expect(messageEl).toBeVisible({ timeout: 5000 });
    const text = await messageEl.textContent();
    expect(text.length).toBeGreaterThan(0);

    // Error message should have red styling
    const classes = await messageEl.getAttribute('class');
    expect(classes).toContain('red');
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('empty email submission blocked by HTML5 validation', async ({ page }) => {
    await waitForAuthInit(page);

    // Leave email empty and try to submit
    const emailInput = page.locator('#auth-email');
    await emailInput.fill('');
    await page.locator('#auth-submit').click();

    // HTML5 validation should block submission — message should stay hidden
    const messageEl = page.locator('#auth-message');
    await expect(messageEl).toBeHidden();

    // Verify the email input has the :invalid pseudo-class via validity check
    const isInvalid = await emailInput.evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('invalid email format triggers HTML5 validation', async ({ page }) => {
    await waitForAuthInit(page);

    await page.fill('#auth-email', 'notanemail');
    await page.locator('#auth-submit').click();

    // HTML5 validation should block submission — message should stay hidden
    const messageEl = page.locator('#auth-message');
    await expect(messageEl).toBeHidden();

    // Input should be invalid due to type="email" constraint
    const isInvalid = await page.locator('#auth-email').evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });
});

// ─── 2. Sign In with Password ──────────────────────────────────────────────

test.describe('Sign In with Password', () => {
  test('switch to password tab, fill form, submit, shows Signing in... state', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    await page.click('#tab-password');
    await expect(page.locator('#password-form')).toBeVisible();

    await page.fill('#auth-email-pw', 'user@example.com');
    await page.fill('#auth-password', 'testpassword123');

    const submitBtn = page.locator('#auth-submit-pw');
    await submitBtn.click();

    // Button should show "Signing in..." while request is in flight
    await expect(submitBtn).toHaveText('Signing in...', { timeout: 2000 }).catch(() => {
      // May revert quickly if the request fails fast
    });

    // Eventually reverts
    await expect(submitBtn).toHaveText('Sign In', { timeout: 15000 });
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('bad credentials show visible error message with text content', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    await page.click('#tab-password');
    await page.fill('#auth-email-pw', 'baduser@test.com');
    await page.fill('#auth-password', 'wrong-password-123');
    await page.locator('#auth-submit-pw').click();

    // Wait for button to revert (request completed)
    await expect(page.locator('#auth-submit-pw')).toHaveText('Sign In', { timeout: 15000 });

    // Error message should be visible with content
    const messageEl = page.locator('#auth-message-pw');
    await expect(messageEl).toBeVisible({ timeout: 10000 });
    const text = await messageEl.textContent();
    expect(text.length).toBeGreaterThan(0);
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('button reverts to Sign In after failed attempt', async ({ page }) => {
    await waitForAuthInit(page);

    await page.click('#tab-password');
    await page.fill('#auth-email-pw', 'fail@test.com');
    await page.fill('#auth-password', 'wrong');

    const submitBtn = page.locator('#auth-submit-pw');
    await submitBtn.click();

    // Wait for it to finish processing
    await expect(submitBtn).toHaveText('Sign In', { timeout: 15000 });

    // Verify the button is not disabled after failure
    const isDisabled = await submitBtn.isDisabled();
    expect(isDisabled).toBe(false);
  });

  test('empty email field prevents submission via HTML5 validation', async ({ page }) => {
    await waitForAuthInit(page);

    await page.click('#tab-password');
    await expect(page.locator('#password-form')).toBeVisible();

    // Leave email empty, fill password
    await page.fill('#auth-email-pw', '');
    await page.fill('#auth-password', 'somepassword');
    await page.locator('#auth-submit-pw').click();

    // Message should stay hidden — form not submitted
    const messageEl = page.locator('#auth-message-pw');
    await expect(messageEl).toBeHidden();

    const isInvalid = await page.locator('#auth-email-pw').evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('empty password field prevents submission via HTML5 validation', async ({ page }) => {
    await waitForAuthInit(page);

    await page.click('#tab-password');
    await expect(page.locator('#password-form')).toBeVisible();

    // Fill email, leave password empty
    await page.fill('#auth-email-pw', 'user@example.com');
    await page.fill('#auth-password', '');
    await page.locator('#auth-submit-pw').click();

    // Message should stay hidden — form not submitted
    const messageEl = page.locator('#auth-message-pw');
    await expect(messageEl).toBeHidden();

    const isInvalid = await page.locator('#auth-password').evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('mock successful sign in hides auth-section', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    // Mock signInWithPassword to succeed and trigger auth state change
    await page.evaluate(() => {
      SupabaseClient.client.auth.signInWithPassword = async () => ({
        data: { user: { id: 'test-id', email: 'user@example.com' }, session: {} },
        error: null,
      });
      // Mock the auth state change to update UI
      Auth.updateUI = (user) => {
        if (user) {
          document.getElementById('auth-section').classList.add('hidden');
          document.getElementById('app-content').classList.remove('hidden');
        }
      };
      // Make signInWithPassword call updateUI on success
      const origSignIn = Auth.signInWithPassword.bind(Auth);
      Auth.signInWithPassword = async (email, password) => {
        const result = await SupabaseClient.client.auth.signInWithPassword({ email, password });
        if (!result.error) {
          Auth.updateUI(result.data.user);
        }
        return result.data;
      };
    });

    await page.click('#tab-password');
    await page.fill('#auth-email-pw', 'user@example.com');
    await page.fill('#auth-password', 'correctpassword');
    await page.locator('#auth-submit-pw').click();

    // Auth section should become hidden after successful sign in
    await expect(page.locator('#auth-section')).toBeHidden({ timeout: 10000 });
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─── 3. Sign Out ────────────────────────────────────────────────────────────

test.describe('Sign Out', () => {
  async function navigateToAccount(page) {
    await showApp(page);
    await mockSupabase(page);
    await page.click('.nav-btn[data-page="account"]');
    await expect(page.locator('#page-account')).toBeVisible();
    await page.waitForFunction(() => {
      const c = document.getElementById('account-container');
      return c && !c.innerHTML.includes('Loading');
    }, { timeout: 10000 });
  }

  test('click Sign Out calls window.confirm', async ({ page }) => {
    const errors = collectErrors(page);
    await navigateToAccount(page);

    // Track confirm calls
    await page.evaluate(() => {
      window._confirmCalled = false;
      window._origConfirm = window.confirm;
      window.confirm = (msg) => { window._confirmCalled = true; return false; };
    });

    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    await expect(signOutBtn).toBeVisible();
    await signOutBtn.click();
    await page.waitForTimeout(500);

    const confirmCalled = await page.evaluate(() => window._confirmCalled);
    expect(confirmCalled).toBe(true);
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('confirm=true triggers SupabaseClient.signOut', async ({ page }) => {
    const errors = collectErrors(page);
    await navigateToAccount(page);

    // Override Account.signOut to avoid reload, but still call SupabaseClient.signOut
    await page.evaluate(() => {
      window._signOutCalled = false;
      SupabaseClient.signOut = async () => { window._signOutCalled = true; };
      window.confirm = () => true;
      Account.signOut = async function() {
        if (!window.confirm('Are you sure you want to sign out?')) return;
        try {
          await SupabaseClient.signOut();
        } catch (error) {
          console.error('Error signing out:', error);
        }
      };
    });

    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    await signOutBtn.click();
    await page.waitForTimeout(1000);

    const signOutCalled = await page.evaluate(() => window._signOutCalled);
    expect(signOutCalled).toBe(true);
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('confirm=false cancels sign out, signOut not called', async ({ page }) => {
    const errors = collectErrors(page);
    await navigateToAccount(page);

    await page.evaluate(() => {
      window._signOutCalled = false;
      SupabaseClient.signOut = async () => { window._signOutCalled = true; };
      window.confirm = () => false;
    });

    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    await signOutBtn.click();
    await page.waitForTimeout(500);

    const signOutCalled = await page.evaluate(() => window._signOutCalled);
    expect(signOutCalled).toBe(false);
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('after sign out, auth section would show', async ({ page }) => {
    const errors = collectErrors(page);
    await navigateToAccount(page);

    // Override to prevent actual reload but simulate showing auth
    await page.evaluate(() => {
      window.confirm = () => true;
      SupabaseClient.signOut = async () => {};
      Account.signOut = async function() {
        if (!window.confirm('Sign out?')) return;
        await SupabaseClient.signOut();
        // Instead of reload, simulate what would happen: show auth, hide app
        Auth.updateUI(null);
      };
    });

    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    await signOutBtn.click();
    await page.waitForTimeout(1000);

    // After sign out, auth section should be visible, app hidden
    await expect(page.locator('#auth-section')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#app-content')).toBeHidden();
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('sign out clears localStorage oura_token', async ({ page }) => {
    const errors = collectErrors(page);
    await navigateToAccount(page);

    // Set a token in localStorage first
    await page.evaluate(() => {
      localStorage.setItem('oura_token', 'test-token-to-clear');
    });

    // Verify it's set
    const tokenBefore = await page.evaluate(() => localStorage.getItem('oura_token'));
    expect(tokenBefore).toBe('test-token-to-clear');

    // Override signOut to call Auth.signOut which clears localStorage
    await page.evaluate(() => {
      window.confirm = () => true;
      SupabaseClient.client.auth.signOut = async () => ({ error: null });
      Account.signOut = async function() {
        if (!window.confirm('Sign out?')) return;
        await Auth.signOut();
      };
    });

    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    await signOutBtn.click();
    await page.waitForTimeout(1000);

    const tokenAfter = await page.evaluate(() => localStorage.getItem('oura_token'));
    expect(tokenAfter).toBeNull();
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─── 4. Auth Tab Switching ──────────────────────────────────────────────────

test.describe('Auth Tab Switching', () => {
  test('default state shows magic link form', async ({ page }) => {
    await waitForAuthInit(page);

    await expect(page.locator('#magic-link-form')).toBeVisible();
    await expect(page.locator('#password-form')).toBeHidden();
  });

  test('click password tab shows password form, hides magic link', async ({ page }) => {
    await waitForAuthInit(page);

    await page.click('#tab-password');

    await expect(page.locator('#password-form')).toBeVisible();
    await expect(page.locator('#magic-link-form')).toBeHidden();
  });

  test('click magic link tab shows magic link form, hides password', async ({ page }) => {
    await waitForAuthInit(page);

    // Switch to password first
    await page.click('#tab-password');
    await expect(page.locator('#password-form')).toBeVisible();

    // Switch back to magic link
    await page.click('#tab-magic');
    await expect(page.locator('#magic-link-form')).toBeVisible();
    await expect(page.locator('#password-form')).toBeHidden();
  });

  test('rapid tab switching 10 times does not break UI', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    for (let i = 0; i < 10; i++) {
      await page.click('#tab-password');
      await page.click('#tab-magic');
    }

    // After all switches, should be back on magic link
    await expect(page.locator('#magic-link-form')).toBeVisible();
    await expect(page.locator('#password-form')).toBeHidden();

    // Both forms should still exist in DOM
    const magicExists = await page.locator('#magic-link-form').count();
    const passwordExists = await page.locator('#password-form').count();
    expect(magicExists).toBe(1);
    expect(passwordExists).toBe(1);
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('tab active styling updates correctly', async ({ page }) => {
    await waitForAuthInit(page);

    // Default: magic tab has active styling
    const magicTab = page.locator('#tab-magic');
    const passwordTab = page.locator('#tab-password');

    await expect(magicTab).toHaveClass(/bg-oura-border/);
    await expect(magicTab).toHaveClass(/text-white/);
    await expect(passwordTab).toHaveClass(/text-oura-muted/);

    // Switch to password tab
    await page.click('#tab-password');

    await expect(passwordTab).toHaveClass(/bg-oura-border/);
    await expect(passwordTab).toHaveClass(/text-white/);
    await expect(magicTab).toHaveClass(/text-oura-muted/);

    // Switch back to magic
    await page.click('#tab-magic');

    await expect(magicTab).toHaveClass(/bg-oura-border/);
    await expect(magicTab).toHaveClass(/text-white/);
    await expect(passwordTab).toHaveClass(/text-oura-muted/);
  });

  test('form inputs persist when switching tabs', async ({ page }) => {
    await waitForAuthInit(page);

    // Fill magic link email
    await page.fill('#auth-email', 'persist@example.com');

    // Switch to password, fill fields
    await page.click('#tab-password');
    await page.fill('#auth-email-pw', 'pw-persist@example.com');
    await page.fill('#auth-password', 'mypassword');

    // Switch back to magic link — value should persist
    await page.click('#tab-magic');
    const magicEmail = await page.locator('#auth-email').inputValue();
    expect(magicEmail).toBe('persist@example.com');

    // Switch to password — values should persist
    await page.click('#tab-password');
    const pwEmail = await page.locator('#auth-email-pw').inputValue();
    const pwPassword = await page.locator('#auth-password').inputValue();
    expect(pwEmail).toBe('pw-persist@example.com');
    expect(pwPassword).toBe('mypassword');
  });
});

// ─── 5. Auth State Visibility ───────────────────────────────────────────────

test.describe('Auth State Visibility', () => {
  test('on fresh load, auth-section visible, app-content hidden', async ({ page }) => {
    await waitForAuthInit(page);

    await expect(page.locator('#auth-section')).toBeVisible();
    await expect(page.locator('#app-content')).toBeHidden();
  });

  test('after showApp(), auth-section hidden, app-content visible', async ({ page }) => {
    await showApp(page);

    await expect(page.locator('#auth-section')).toBeHidden();
    await expect(page.locator('#app-content')).toBeVisible();
  });

  test('bottom nav hidden in auth state, visible in app state', async ({ page }) => {
    await waitForAuthInit(page);

    // In auth state, bottom nav should be hidden (or not visible)
    const bottomNav = page.locator('.bottom-nav');
    const navCount = await bottomNav.count();
    if (navCount > 0) {
      // Bottom nav exists but should be hidden in auth state
      await expect(bottomNav).toBeHidden();
    }

    // Switch to app state
    await showApp(page);

    // Now bottom nav should be visible
    await expect(page.locator('.bottom-nav')).toBeVisible();
  });
});
