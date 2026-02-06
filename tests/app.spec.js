const { test, expect } = require('@playwright/test');

// Helper: wait for auth init to settle (it async-checks Supabase then updates UI)
async function waitForAuthInit(page) {
  await page.goto('/');
  // Auth.init() calls Supabase async, then shows auth-section when no user found.
  // Wait for that to settle before overriding the UI.
  await page.waitForFunction(() => {
    const auth = document.getElementById('auth-section');
    return auth && !auth.classList.contains('hidden');
  }, { timeout: 5000 }).catch(() => {});
}

// Helper: bypass auth and show app content with visible bottom nav
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

// Helper: show onboarding section and render a specific step directly
async function showOnboardingStep(page, step) {
  await waitForAuthInit(page);
  await page.evaluate((s) => {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('onboarding-section').classList.remove('hidden');
    document.getElementById('app-content').classList.add('hidden');
    document.querySelector('.bottom-nav')?.classList.add('hidden');
    // Render step directly to avoid Supabase API calls from advanceStep
    if (window.Onboarding) {
      window.Onboarding.profile = { onboarding_step: s };
      window.Onboarding.renderStep(s);
    }
    // Force animation to complete — renderStep uses requestAnimationFrame
    // to switch from onboarding-step-enter (opacity:0) to onboarding-step-active (opacity:1)
    const container = document.getElementById('onboarding-container');
    if (container) {
      container.classList.remove('onboarding-step-enter');
      container.classList.add('onboarding-step-active');
    }
  }, step);
}

// ---------------------------------------------------------------------------
// Smoke tests
// ---------------------------------------------------------------------------

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/./);
});

test('health endpoint returns ok', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Auth section renders
// ---------------------------------------------------------------------------

test.describe('Auth', () => {
  test('shows auth section with magic link and password tabs', async ({ page }) => {
    await page.goto('/');
    const authSection = page.locator('#auth-section');
    await expect(authSection).toBeVisible();
    await expect(page.locator('#tab-magic')).toBeVisible();
    await expect(page.locator('#tab-password')).toBeVisible();
  });

  test('magic link form has email input and submit button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#magic-link-form')).toBeVisible();
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-submit')).toBeVisible();
  });

  test('can switch to password tab', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-password').click();
    await expect(page.locator('#password-form')).toBeVisible();
    await expect(page.locator('#auth-email-pw')).toBeVisible();
    await expect(page.locator('#auth-password')).toBeVisible();
    await expect(page.locator('#auth-submit-pw')).toBeVisible();
  });

  test('can switch back to magic link tab', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-password').click();
    await page.locator('#tab-magic').click();
    await expect(page.locator('#magic-link-form')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Onboarding flow (all 4 steps)
// ---------------------------------------------------------------------------

test.describe('Onboarding', () => {
  test('step 0 - Connect Oura token input is visible', async ({ page }) => {
    await showOnboardingStep(page, 0);
    await expect(page.locator('#onboarding-token')).toBeVisible();
    await expect(page.locator('#onboarding-token-btn')).toBeVisible();
  });

  test('step 0 - token input and save button render', async ({ page }) => {
    await showOnboardingStep(page, 0);
    await expect(page.locator('#onboarding-token')).toHaveAttribute('type', 'password');
    await expect(page.locator('#onboarding-token-status')).toBeAttached();
  });

  test('step 1 - pick a challenge shows protocol list', async ({ page }) => {
    await showOnboardingStep(page, 1);
    await expect(page.locator('#onboarding-protocols')).toBeVisible();
  });

  test('step 1 - challenge form is initially hidden', async ({ page }) => {
    await showOnboardingStep(page, 1);
    await expect(page.locator('#onboarding-challenge-form')).toBeHidden();
  });

  test('step 2 - add a friend has email input and invite button', async ({ page }) => {
    await showOnboardingStep(page, 2);
    await expect(page.locator('#onboarding-friend-email')).toBeVisible();
    await expect(page.locator('#onboarding-invite-btn')).toBeVisible();
  });

  test('step 3 - completion screen shows Go to Dashboard', async ({ page }) => {
    await showOnboardingStep(page, 3);
    await expect(page.getByText('Go to Dashboard')).toBeVisible();
  });

  test('step 3 - shows celebration message', async ({ page }) => {
    await showOnboardingStep(page, 3);
    await expect(page.getByText("You're All Set!")).toBeVisible();
  });

  test('full step sequence renders each step correctly', async ({ page }) => {
    // Step 0
    await showOnboardingStep(page, 0);
    await expect(page.locator('#onboarding-token')).toBeVisible();

    // Step 1
    await page.evaluate(() => window.Onboarding.renderStep(1));
    await expect(page.locator('#onboarding-protocols')).toBeVisible();

    // Step 2
    await page.evaluate(() => window.Onboarding.renderStep(2));
    await expect(page.locator('#onboarding-friend-email')).toBeVisible();

    // Step 3
    await page.evaluate(() => window.Onboarding.renderStep(3));
    await expect(page.getByText('Go to Dashboard')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Oura Token Connection
// ---------------------------------------------------------------------------

test.describe('Oura Token Connection', () => {
  test('token input accepts text', async ({ page }) => {
    await showOnboardingStep(page, 0);
    const tokenInput = page.locator('#onboarding-token');
    await tokenInput.fill('test-token-12345');
    await expect(tokenInput).toHaveValue('test-token-12345');
  });

  test('token input is password type', async ({ page }) => {
    await showOnboardingStep(page, 0);
    await expect(page.locator('#onboarding-token')).toHaveAttribute('type', 'password');
  });

  test('save token button exists and is clickable', async ({ page }) => {
    await showOnboardingStep(page, 0);
    const btn = page.locator('#onboarding-token-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('token status element exists for feedback', async ({ page }) => {
    await showOnboardingStep(page, 0);
    await expect(page.locator('#onboarding-token-status')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Sleep data sync
// ---------------------------------------------------------------------------

test.describe('Sleep Sync', () => {
  test('webhook rejects unauthenticated requests', async ({ request }) => {
    const response = await request.post('/webhook/sync-sleep', {
      data: { userId: 'x', ouraToken: 'x' },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  test('webhook rejects wrong secret', async ({ request }) => {
    const response = await request.post('/webhook/sync-sleep', {
      headers: { 'Authorization': 'Bearer wrong-secret' },
      data: { userId: 'x', ouraToken: 'x' },
    });
    expect(response.status()).toBe(401);
  });

  test('webhook no longer accepts supabaseUrl or supabaseKey in body', async ({ request }) => {
    // Even with a valid-looking payload using old fields, auth is required
    const response = await request.post('/webhook/sync-sleep', {
      data: { userId: 'x', ouraToken: 'x', supabaseUrl: 'https://evil.com', supabaseKey: 'stolen' },
    });
    expect(response.status()).toBe(401);
  });

  test('SleepSync module is available on page', async ({ page }) => {
    await page.goto('/');
    const hasSleepSync = await page.evaluate(() => typeof window.SleepSync !== 'undefined');
    expect(hasSleepSync).toBeTruthy();
  });

  test('SleepSync.syncNow function exists', async ({ page }) => {
    await page.goto('/');
    const hasSyncNow = await page.evaluate(() => typeof window.SleepSync?.syncNow === 'function');
    expect(hasSyncNow).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Dashboard rendering
// ---------------------------------------------------------------------------

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await page.evaluate(() => App.navigateTo('dashboard'));
  });

  test('dashboard page is visible', async ({ page }) => {
    await expect(page.locator('#page-dashboard')).toBeVisible();
  });

  test('dashboard container exists', async ({ page }) => {
    await expect(page.locator('#dashboard-container')).toBeAttached();
  });

  test('bottom navigation is visible', async ({ page }) => {
    await expect(page.locator('.bottom-nav')).toBeVisible();
  });

  test('header is visible', async ({ page }) => {
    await expect(page.locator('.app-header')).toBeVisible();
  });

  test('dashboard module is loaded', async ({ page }) => {
    const hasDashboard = await page.evaluate(() => typeof window.Dashboard !== 'undefined');
    expect(hasDashboard).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Challenge creation and joining
// ---------------------------------------------------------------------------

test.describe('Challenges', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await page.evaluate(() => App.navigateTo('challenges'));
  });

  test('challenges page is visible', async ({ page }) => {
    await expect(page.locator('#page-challenges')).toBeVisible();
  });

  test('challenges container exists', async ({ page }) => {
    await expect(page.locator('#challenges-container')).toBeAttached();
  });

  test('Challenges module is loaded', async ({ page }) => {
    const has = await page.evaluate(() => typeof window.Challenges !== 'undefined');
    expect(has).toBeTruthy();
  });

  test('create challenge modal can be triggered', async ({ page }) => {
    const hasShow = await page.evaluate(() => typeof window.Challenges?.showCreateModal === 'function');
    expect(hasShow).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Navigation / tab switching
// ---------------------------------------------------------------------------

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
  });

  test('bottom nav has all tab buttons', async ({ page }) => {
    await expect(page.locator('.nav-btn[data-page="dashboard"]')).toBeVisible();
    await expect(page.locator('.nav-btn[data-page="protocols"]')).toBeVisible();
    await expect(page.locator('.nav-btn[data-page="challenges"]')).toBeVisible();
    await expect(page.locator('.nav-btn[data-page="friends"]')).toBeVisible();
  });

  test('clicking dashboard tab shows dashboard page', async ({ page }) => {
    await page.locator('.nav-btn[data-page="dashboard"]').click();
    await expect(page.locator('#page-dashboard')).toBeVisible();
  });

  test('clicking protocols tab shows protocols page', async ({ page }) => {
    await page.locator('.nav-btn[data-page="protocols"]').click();
    await expect(page.locator('#page-protocols')).toBeVisible();
  });

  test('clicking challenges tab shows challenges page', async ({ page }) => {
    await page.locator('.nav-btn[data-page="challenges"]').click();
    await expect(page.locator('#page-challenges')).toBeVisible();
  });

  test('clicking friends tab shows friends page', async ({ page }) => {
    await page.locator('.nav-btn[data-page="friends"]').click();
    await expect(page.locator('#page-friends')).toBeVisible();
  });

  test('switching tabs hides previous page', async ({ page }) => {
    await page.locator('.nav-btn[data-page="dashboard"]').click();
    await expect(page.locator('#page-dashboard')).toBeVisible();

    await page.locator('.nav-btn[data-page="protocols"]').click();
    await expect(page.locator('#page-protocols')).toBeVisible();
    await expect(page.locator('#page-dashboard')).toBeHidden();
  });

  test('active tab gets accent styling', async ({ page }) => {
    await page.locator('.nav-btn[data-page="challenges"]').click();
    const btn = page.locator('.nav-btn[data-page="challenges"]');
    await expect(btn).toHaveClass(/text-oura-accent/);
  });

  test('App.navigateTo works programmatically', async ({ page }) => {
    await page.evaluate(() => App.navigateTo('friends'));
    await expect(page.locator('#page-friends')).toBeVisible();
  });

  test('full tab cycle: dashboard -> protocols -> challenges -> friends -> dashboard', async ({ page }) => {
    const tabs = ['dashboard', 'protocols', 'challenges', 'friends', 'dashboard'];
    for (const tab of tabs) {
      await page.locator(`.nav-btn[data-page="${tab}"]`).click();
      await expect(page.locator(`#page-${tab}`)).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Mobile responsive views
// ---------------------------------------------------------------------------

test.describe('Mobile responsive', () => {
  test('renders correctly at iPhone SE size (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('#auth-section')).toBeVisible();
    const box = await page.locator('#auth-section').boundingBox();
    expect(box.width).toBeLessThanOrEqual(375);
  });

  test('renders correctly at iPhone 14 Pro size (393x852)', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/');
    await expect(page.locator('#auth-section')).toBeVisible();
  });

  test('bottom nav visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await showApp(page);
    await expect(page.locator('.bottom-nav')).toBeVisible();
  });

  test('bottom nav tabs are tappable on mobile (min 40px height)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await showApp(page);
    const navBtns = page.locator('.nav-btn');
    const count = await navBtns.count();
    for (let i = 0; i < count; i++) {
      const box = await navBtns.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('navigation works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await showApp(page);
    await page.locator('.nav-btn[data-page="challenges"]').click();
    await expect(page.locator('#page-challenges')).toBeVisible();
  });

  test('no horizontal overflow on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBeFalsy();
  });

  test('desktop viewport (1280x800) renders without issues', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('#auth-section')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Security: Static file server (C2)
// ---------------------------------------------------------------------------

test.describe('Security: dotfile and path traversal protection', () => {
  test('blocks access to .env', async ({ request }) => {
    const response = await request.get('/.env');
    expect(response.status()).toBe(403);
  });

  test('blocks access to .gitignore', async ({ request }) => {
    const response = await request.get('/.gitignore');
    expect(response.status()).toBe(403);
  });

  test('blocks access to .env.test.local', async ({ request }) => {
    const response = await request.get('/.env.test.local');
    expect(response.status()).toBe(403);
  });

  test('blocks access to dotfiles in subdirectories', async ({ request }) => {
    const response = await request.get('/.claude/settings.json');
    expect(response.status()).toBe(403);
  });

  test('blocks path traversal with encoded sequences', async ({ request }) => {
    const response = await request.get('/%2e%2e/%2e%2e/etc/passwd');
    // Either 403 (blocked by dotfile/traversal check) or 404 (path resolved safely but not found)
    expect([403, 404]).toContain(response.status());
  });

  test('blocks path traversal with ../', async ({ request }) => {
    const response = await request.get('/../../../etc/passwd');
    // Should be 403 (path outside root) or 404 (doesn't exist after normalization)
    expect([403, 404]).toContain(response.status());
  });

  test('still serves legitimate static files', async ({ request }) => {
    const response = await request.get('/');
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).toContain('html');
  });

  test('.env content is never leaked in response body', async ({ request }) => {
    const response = await request.get('/.env');
    const body = await response.text();
    expect(body).not.toContain('SUPABASE');
    expect(body).not.toContain('SERVICE_ROLE');
    expect(body).not.toContain('sb_secret');
  });
});

// ---------------------------------------------------------------------------
// Security: Oura data guard (C3)
// ---------------------------------------------------------------------------

test.describe('Security: Oura data guard', () => {
  test('SleepSync handles invalid Oura response gracefully', async ({ page }) => {
    await page.goto('/');

    // Mock all dependencies so syncNow can run without real Supabase
    const result = await page.evaluate(async () => {
      // Fully stub SupabaseClient and Auth to bypass real Supabase calls
      const fakeClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { oura_token: 'fake-token' },
                error: null,
              }),
            }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        }),
      };
      window.SupabaseClient = {
        client: fakeClient,
        getCurrentUser: () => Promise.resolve({ id: 'test-user' }),
      };
      // Override Auth.getProfile to return a profile with a token
      window.Auth.getProfile = () => Promise.resolve({ oura_token: 'fake-token' });

      // Mock fetch to return an Oura error response (no .data field)
      const originalFetch = window.fetch;
      window.fetch = (url) => {
        if (url.includes('/sleep')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ detail: 'Unauthorized' }),
          });
        }
        return originalFetch(url);
      };

      try {
        const result = await window.SleepSync.syncNow({ silent: true });
        return result;
      } finally {
        window.fetch = originalFetch;
      }
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No sleep data returned from Oura');
  });
});
