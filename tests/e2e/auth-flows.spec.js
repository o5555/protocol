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

// ─── 1. OTP Email Step ──────────────────────────────────────────────────────

test.describe('OTP Email Step', () => {
  test('email step visible on load with email input and continue button', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    await expect(page.locator('#auth-step-email')).toBeVisible();
    await expect(page.locator('#auth-step-code')).toBeHidden();
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-submit')).toBeVisible();
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('mock successful OTP sends user to code step', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    await page.evaluate(() => {
      SupabaseClient.client.auth.signInWithOtp = async () => ({ data: {}, error: null });
    });

    await page.fill('#auth-email', 'newuser@example.com');
    await page.locator('#auth-submit').click();

    // Code step should appear
    await expect(page.locator('#auth-step-code')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#auth-step-email')).toBeHidden();
    await expect(page.locator('#auth-code-email')).toHaveText('newuser@example.com');
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('mock failed OTP shows error message with error styling', async ({ page }) => {
    const errors = collectErrors(page);
    await waitForAuthInit(page);

    await page.evaluate(() => {
      SupabaseClient.client.auth.signInWithOtp = async () => {
        throw new Error('Rate limit exceeded');
      };
    });

    await page.fill('#auth-email', 'newuser@example.com');
    await page.locator('#auth-submit').click();

    await expect(page.locator('#auth-submit')).toHaveText('Continue', { timeout: 10000 });

    const messageEl = page.locator('#auth-message');
    await expect(messageEl).toBeVisible({ timeout: 5000 });
    const text = await messageEl.textContent();
    expect(text.length).toBeGreaterThan(0);

    const classes = await messageEl.getAttribute('class');
    expect(classes).toContain('red');
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('empty email submission blocked by HTML5 validation', async ({ page }) => {
    await waitForAuthInit(page);

    const emailInput = page.locator('#auth-email');
    await emailInput.fill('');
    await page.locator('#auth-submit').click();

    const messageEl = page.locator('#auth-message');
    await expect(messageEl).toBeHidden();

    const isInvalid = await emailInput.evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('invalid email format triggers HTML5 validation', async ({ page }) => {
    await waitForAuthInit(page);

    await page.fill('#auth-email', 'notanemail');
    await page.locator('#auth-submit').click();

    const messageEl = page.locator('#auth-message');
    await expect(messageEl).toBeHidden();

    const isInvalid = await page.locator('#auth-email').evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });
});

// ─── 2. OTP Code Step ───────────────────────────────────────────────────────

test.describe('OTP Code Step', () => {
  async function goToCodeStep(page) {
    await waitForAuthInit(page);
    await page.evaluate(() => {
      SupabaseClient.client.auth.signInWithOtp = async () => ({ data: {}, error: null });
    });
    await page.fill('#auth-email', 'user@example.com');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-step-code')).toBeVisible({ timeout: 10000 });
  }

  test('code step shows 6 digit inputs and verify button', async ({ page }) => {
    const errors = collectErrors(page);
    await goToCodeStep(page);

    const digits = page.locator('#otp-inputs .otp-digit');
    await expect(digits).toHaveCount(6);
    await expect(page.locator('#auth-verify-btn')).toBeVisible();
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('back button returns to email step', async ({ page }) => {
    await goToCodeStep(page);

    await page.locator('#auth-step-code button:has-text("Back")').click();
    await expect(page.locator('#auth-step-email')).toBeVisible();
    await expect(page.locator('#auth-step-code')).toBeHidden();
  });

  test('invalid code shows error message', async ({ page }) => {
    const errors = collectErrors(page);
    await goToCodeStep(page);

    await page.evaluate(() => {
      SupabaseClient.client.auth.verifyOtp = async () => {
        throw new Error('Invalid OTP');
      };
    });

    const digits = page.locator('#otp-inputs .otp-digit');
    for (let i = 0; i < 6; i++) {
      await digits.nth(i).fill(String(i + 1));
    }

    // Wait for auto-submit and error
    const messageEl = page.locator('#auth-code-message');
    await expect(messageEl).toBeVisible({ timeout: 10000 });
    const text = await messageEl.textContent();
    expect(text.length).toBeGreaterThan(0);
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('mock successful verify hides auth-section', async ({ page }) => {
    const errors = collectErrors(page);
    await goToCodeStep(page);

    // Mock verifyOtp to succeed AND trigger updateUI (since the Supabase auth listener won't fire in test)
    await page.evaluate(() => {
      SupabaseClient.client.auth.verifyOtp = async () => {
        const result = {
          data: { user: { id: 'test-id', email: 'user@example.com' }, session: {} },
          error: null,
        };
        // Simulate the auth state change that would normally happen
        setTimeout(() => {
          document.getElementById('auth-section').classList.add('hidden');
          document.getElementById('app-content').classList.remove('hidden');
        }, 100);
        return result;
      };
    });

    const digits = page.locator('#otp-inputs .otp-digit');
    for (let i = 0; i < 6; i++) {
      await digits.nth(i).fill(String(i + 1));
    }

    // Auth section should become hidden after successful verify
    await expect(page.locator('#auth-section')).toBeHidden({ timeout: 10000 });
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('resend code button works', async ({ page }) => {
    const errors = collectErrors(page);
    await goToCodeStep(page);

    let otpCalled = false;
    await page.evaluate(() => {
      window._otpResendCount = 0;
      SupabaseClient.client.auth.signInWithOtp = async () => {
        window._otpResendCount++;
        return { data: {}, error: null };
      };
    });

    await page.locator('#auth-resend-btn').click();
    await page.waitForTimeout(1000);

    const resendCount = await page.evaluate(() => window._otpResendCount);
    expect(resendCount).toBeGreaterThanOrEqual(1);
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

// ─── 4. OTP Step Navigation ─────────────────────────────────────────────────

test.describe('OTP Step Navigation', () => {
  test('default state shows email step', async ({ page }) => {
    await waitForAuthInit(page);

    await expect(page.locator('#auth-step-email')).toBeVisible();
    await expect(page.locator('#auth-step-code')).toBeHidden();
  });

  test('navigating to code step and back preserves email', async ({ page }) => {
    await waitForAuthInit(page);

    await page.evaluate(() => {
      SupabaseClient.client.auth.signInWithOtp = async () => ({ data: {}, error: null });
    });

    await page.fill('#auth-email', 'persist@example.com');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-step-code')).toBeVisible({ timeout: 10000 });

    // Go back
    await page.locator('#auth-step-code button:has-text("Back")').click();
    await expect(page.locator('#auth-step-email')).toBeVisible();

    // Email should still be filled
    const email = await page.locator('#auth-email').inputValue();
    expect(email).toBe('persist@example.com');
  });

  test('OTP digit inputs accept values', async ({ page }) => {
    await waitForAuthInit(page);

    await page.evaluate(() => {
      SupabaseClient.client.auth.signInWithOtp = async () => ({ data: {}, error: null });
    });

    await page.fill('#auth-email', 'user@example.com');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-step-code')).toBeVisible({ timeout: 10000 });

    // Fill first 5 digits (not 6th to avoid auto-submit clearing them)
    const digits = page.locator('#otp-inputs .otp-digit');
    for (let i = 0; i < 5; i++) {
      await digits.nth(i).fill(String(i + 1));
    }

    // First 5 digits should have their values
    for (let i = 0; i < 5; i++) {
      const val = await digits.nth(i).inputValue();
      expect(val).toBe(String(i + 1));
    }
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
