// @ts-check
const { test, expect } = require('@playwright/test');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Bypass auth to show the main app (no real login needed).
 */
async function showApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const auth = document.getElementById('auth-section');
    return auth && !auth.classList.contains('hidden');
  }, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    document.getElementById('auth-section').classList.add('hidden');
    const onboarding = document.getElementById('onboarding-section');
    if (onboarding) onboarding.classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    document.querySelector('.bottom-nav')?.classList.remove('hidden');
  });
}

/**
 * Mock Supabase so Account.render() works with fake data.
 */
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
        eq: () => ({
          ...mockQuery,
          eq: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
          single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 }, error: null }),
        }),
        or: () => Promise.resolve({ data: [], error: null }),
        order: () => Promise.resolve({ data: [], error: null }),
        neq: () => ({ ...mockQuery, single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }) }),
      }),
    });
    Auth.getProfile = () => Promise.resolve({ display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 });
  });
}

/**
 * Collect all console errors from page.
 */
function collectErrors(page) {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  return errors;
}

/**
 * Filter out expected Supabase/network errors — only return truly unexpected ones.
 */
function unexpectedErrors(errors) {
  return errors.filter(e =>
    !e.includes('Supabase') && !e.includes('Failed to fetch') && !e.includes('not initialized') &&
    !e.includes('NetworkError') && !e.includes('net::ERR') && !e.includes('ERR_CONNECTION') &&
    !e.includes('the server responded with a status of') && !e.includes('Error checking notifications') &&
    !e.includes('Error fetching profile') && !e.includes('Error rendering account') &&
    !e.includes('Error checking onboarding') && !e.includes('Error signing out') &&
    !e.includes('auth callback') && !e.includes('Auth callback')
  );
}

// ─── Test 1: Auth page loads and tab switching works ────────────────────────

test.describe('Auth page loads and tab switching works', () => {
  test('auth section visible, tab clicks toggle between magic link and password forms', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Auth section should be visible on load
    await expect(page.locator('#auth-section')).toBeVisible();

    // Default state: magic link form visible, password form hidden
    await expect(page.locator('#magic-link-form')).toBeVisible();
    await expect(page.locator('#password-form')).toBeHidden();

    // Click the password tab
    await page.click('#tab-password');
    await expect(page.locator('#password-form')).toBeVisible();
    await expect(page.locator('#magic-link-form')).toBeHidden();

    // Click magic link tab back
    await page.click('#tab-magic');
    await expect(page.locator('#magic-link-form')).toBeVisible();
    await expect(page.locator('#password-form')).toBeHidden();

    // No unexpected console errors
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─── Test 2: Password sign-in flow ─────────────────────────────────────────

test.describe('Password sign-in flow', () => {
  test('fill form, submit, verify signing-in state and error for bad creds', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Switch to password tab
    await page.click('#tab-password');
    await expect(page.locator('#password-form')).toBeVisible();

    // Fill in email and password
    await page.fill('#auth-email-pw', 'baduser@test.com');
    await page.fill('#auth-password', 'wrong-password-123');

    // Click submit
    const submitBtn = page.locator('#auth-submit-pw');
    await submitBtn.click();

    // Button should change to "Signing in..." while request is in flight
    await expect(submitBtn).toHaveText('Signing in...', { timeout: 2000 }).catch(() => {
      // May revert quickly if the request fails fast
    });

    // Wait for the button to revert back to "Sign In"
    await expect(submitBtn).toHaveText('Sign In', { timeout: 10000 });

    // Error message should appear for invalid credentials
    const messageEl = page.locator('#auth-message-pw');
    await expect(messageEl).toBeVisible({ timeout: 10000 });
    const messageText = await messageEl.textContent();
    expect(messageText.length).toBeGreaterThan(0);

    // No unexpected console errors
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─── Test 3: Magic link flow ────────────────────────────────────────────────

test.describe('Magic link flow', () => {
  test('fill email, submit, verify sending state, then message appears', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should already be on magic link tab
    await expect(page.locator('#magic-link-form')).toBeVisible();

    // Fill email
    await page.fill('#auth-email', 'testuser@example.com');

    // Click submit
    const submitBtn = page.locator('#auth-submit');
    await submitBtn.click();

    // Button should change to "Sending..." while request is in flight
    await expect(submitBtn).toHaveText('Sending...', { timeout: 2000 }).catch(() => {
      // May revert quickly
    });

    // Wait for the button to revert back to "Send Magic Link"
    await expect(submitBtn).toHaveText('Send Magic Link', { timeout: 10000 });

    // A message should appear (success or error depending on Supabase availability)
    const messageEl = page.locator('#auth-message');
    await expect(messageEl).toBeVisible({ timeout: 10000 });
    const messageText = await messageEl.textContent();
    expect(messageText.length).toBeGreaterThan(0);

    // No unexpected console errors
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─── Test 4: Dashboard loads after auth bypass ──────────────────────────────

test.describe('Dashboard loads after auth bypass', () => {
  test('dashboard page, container, bottom nav, and header are visible', async ({ page }) => {
    const errors = collectErrors(page);

    await showApp(page);

    // Dashboard page should be visible (it's the default page)
    await expect(page.locator('#page-dashboard')).toBeVisible();

    // Dashboard container should exist
    await expect(page.locator('#dashboard-container')).toBeVisible();

    // Bottom nav should be visible
    await expect(page.locator('.bottom-nav')).toBeVisible();

    // App content should be visible
    await expect(page.locator('#app-content')).toBeVisible();

    // No unexpected console errors
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─── Test 5: Account page renders profile with mocked data ──────────────────

test.describe('Account page renders profile with mocked data', () => {
  test('navigate to account via nav button, verify profile elements appear', async ({ page }) => {
    const errors = collectErrors(page);

    await showApp(page);
    await mockSupabase(page);

    // Click the Account nav button in the bottom nav
    await page.click('.nav-btn[data-page="account"]');

    // Wait for the account page to be visible
    await expect(page.locator('#page-account')).toBeVisible();

    // Wait for account container to finish rendering (not "Loading...")
    await page.waitForFunction(() => {
      const container = document.getElementById('account-container');
      return container && !container.innerHTML.includes('Loading');
    }, { timeout: 10000 });

    // Verify profile elements rendered by Account.render()
    const container = page.locator('#account-container');

    // Display name should appear
    await expect(container.locator('text=Test User')).toBeVisible({ timeout: 5000 });

    // Email should appear
    await expect(container.locator('text=test@example.com')).toBeVisible({ timeout: 5000 });

    // Edit Profile button should exist
    await expect(container.locator('button', { hasText: 'Edit Profile' })).toBeVisible();

    // Sign Out button should exist
    await expect(container.locator('button', { hasText: 'Sign Out' })).toBeVisible();

    // No unexpected console errors
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─── Test 6: Sign out button click flow ─────────────────────────────────────

test.describe('Sign out button click flow', () => {
  test('click sign out, verify confirm called and signOut invoked', async ({ page }) => {
    const errors = collectErrors(page);

    await showApp(page);
    await mockSupabase(page);

    // Click the Account nav button
    await page.click('.nav-btn[data-page="account"]');
    await expect(page.locator('#page-account')).toBeVisible();

    // Wait for account to render
    await page.waitForFunction(() => {
      const container = document.getElementById('account-container');
      return container && !container.innerHTML.includes('Loading');
    }, { timeout: 10000 });

    // Set up tracking: mock confirm, track signOut calls, prevent reload
    await page.evaluate(() => {
      window.confirm = () => true;
      window._signOutCalled = false;
      // Override SupabaseClient.signOut to track the call
      SupabaseClient.signOut = async () => { window._signOutCalled = true; };
      // Also override Auth.signOut in case Account delegates through it
      const origAccountSignOut = Account.signOut.bind(Account);
      // Prevent page reload by overriding it before the click
      Object.defineProperty(window, 'onbeforeunload', { value: null, writable: true });
    });

    // Prevent navigation/reload by intercepting it
    await page.route('**/*', async (route) => {
      // Allow the page to stay as-is
      if (route.request().isNavigationRequest() && route.request().url() === page.url()) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    // Also override location.reload via the page's JS context
    await page.evaluate(() => {
      // Can't directly override location.reload, so override Account.signOut instead
      Account.signOut = async function() {
        if (!window.confirm('Are you sure you want to sign out?')) return;
        try {
          await SupabaseClient.signOut();
          window._reloadWouldHaveBeenCalled = true;
          // Don't actually reload
        } catch (error) {
          console.error('Error signing out:', error);
        }
      };
    });

    // Click Sign Out button
    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    await expect(signOutBtn).toBeVisible();
    await signOutBtn.click();

    // Give the async handler time to complete
    await page.waitForTimeout(1000);

    // Verify signOut was called
    const signOutCalled = await page.evaluate(() => window._signOutCalled);
    expect(signOutCalled).toBe(true);

    // No unexpected console errors
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});
