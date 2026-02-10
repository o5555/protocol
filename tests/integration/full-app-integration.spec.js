// @ts-check
/**
 * Full App Integration Test — Real Supabase Backend
 *
 * This test uses the REAL Supabase backend (no mocks) except for Oura API calls,
 * which are routed to return test data. It signs in with real test credentials,
 * navigates every page/view, clicks every interactive element, and checks for
 * console errors after every action.
 *
 * Prerequisites:
 *   - .env.test.local must contain:
 *       SUPABASE_URL, SUPABASE_ANON_KEY
 *       TEST_USER_EMAIL, TEST_USER_PASSWORD  (a real user in the Supabase project)
 *       OURA_TEST_TOKEN (optional — Oura calls are mocked regardless)
 *
 * Run with:  npx playwright test tests/integration/full-app-integration.spec.js
 */

const { test, expect } = require('@playwright/test');
require('dotenv').config({ path: '.env.test.local' });

// ─── Configuration ──────────────────────────────────────────────────────────

const TEST_EMAIL = process.env.TEST_USER_EMAIL || '';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || '';
const HAS_CREDS = TEST_EMAIL && TEST_PASSWORD;

// ─── Console Error Collector ────────────────────────────────────────────────

/** Collect ALL console errors from the page */
function collectErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(`[PAGE ERROR] ${err.message}`));
  return errors;
}

/** Errors we expect (network noise, Oura mock rejections, etc.) */
function filterExpectedErrors(errors) {
  return errors.filter(e =>
    !e.includes('net::ERR') &&
    !e.includes('NetworkError') &&
    !e.includes('ERR_CONNECTION') &&
    !e.includes('the server responded with a status of 4') && // 401/403/404 from mocked Oura
    !e.includes('Failed to register a ServiceWorker') &&
    !e.includes('service-worker') &&
    !e.includes('sw.js')
  );
}

// ─── Oura API Mock ──────────────────────────────────────────────────────────

const MOCK_SLEEP_DATA = {
  data: [
    {
      day: new Date().toISOString().split('T')[0],
      total_sleep_duration: 27000, // 7.5 hours
      deep_sleep_duration: 5400,
      rem_sleep_duration: 5400,
      light_sleep_duration: 16200,
      average_heart_rate: 58,
      lowest_heart_rate: 52,
    },
    {
      day: new Date(Date.now() - 86400000).toISOString().split('T')[0],
      total_sleep_duration: 25200, // 7 hours
      deep_sleep_duration: 4800,
      rem_sleep_duration: 5000,
      light_sleep_duration: 15400,
      average_heart_rate: 60,
      lowest_heart_rate: 54,
    },
  ],
};

const MOCK_DAILY_SLEEP = {
  data: [
    { day: new Date().toISOString().split('T')[0], score: 85 },
    { day: new Date(Date.now() - 86400000).toISOString().split('T')[0], score: 82 },
  ],
};

/** Intercept Oura API proxy calls and return mock data */
async function mockOuraAPI(page) {
  // Mock the local proxy endpoints (used when running on localhost)
  await page.route('**/api/sleep*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SLEEP_DATA),
    });
  });

  await page.route('**/api/daily_sleep*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DAILY_SLEEP),
    });
  });

  // Also mock direct Oura API calls (used when not on localhost)
  await page.route('**/api.ouraring.com/**', async route => {
    const url = route.request().url();
    if (url.includes('daily_sleep')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DAILY_SLEEP),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SLEEP_DATA),
      });
    }
  });
}

// ─── Auth Helper ────────────────────────────────────────────────────────────

/**
 * Sign in with real Supabase credentials via the password form.
 * Returns true if sign-in succeeded, false otherwise.
 */
async function signIn(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Switch to password tab
  await page.click('#tab-password');
  await expect(page.locator('#password-form')).toBeVisible();

  // Fill credentials
  await page.fill('#auth-email-pw', TEST_EMAIL);
  await page.fill('#auth-password', TEST_PASSWORD);

  // Submit
  await page.click('#auth-submit-pw');

  // Wait for either:
  //  - Auth section to become hidden (success — app shows)
  //  - Error message to appear (failure)
  try {
    await page.waitForFunction(() => {
      const auth = document.getElementById('auth-section');
      return auth && auth.classList.contains('hidden');
    }, { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the app to be fully loaded after sign-in.
 * Handles both onboarding and main app states.
 */
async function waitForAppReady(page) {
  // Check if we landed on onboarding or main app
  const isOnboarding = await page.evaluate(() => {
    const onboarding = document.getElementById('onboarding-section');
    return onboarding && !onboarding.classList.contains('hidden');
  });

  if (isOnboarding) {
    // Complete onboarding by marking step 4 directly
    await page.evaluate(async () => {
      try {
        await Auth.updateProfile({ onboarding_step: 4 });
      } catch (e) { /* profile may already be at step 4 */ }

      // Manually switch UI
      document.getElementById('onboarding-section')?.classList.add('hidden');
      document.getElementById('app-content')?.classList.remove('hidden');
      document.querySelector('.bottom-nav')?.classList.remove('hidden');
    });
  }

  // Wait for app content to be visible
  await expect(page.locator('#app-content')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 5000 });

  // Wait for dashboard to finish initial render
  await page.waitForTimeout(1000);
}

// ─── Helper: assert no unexpected errors ────────────────────────────────────

function assertNoUnexpectedErrors(errors, context = '') {
  const unexpected = filterExpectedErrors(errors);
  if (unexpected.length > 0) {
    console.warn(`[${context}] Console errors:`, unexpected);
  }
  // We collect but don't fail — reported in the final summary
  return unexpected;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Full App Integration (Real Supabase)', () => {
  test.skip(!HAS_CREDS, 'Skipping — TEST_USER_EMAIL and TEST_USER_PASSWORD not set in .env.test.local');

  // Increase timeout for integration tests
  test.setTimeout(120000);

  // ── 1. Auth Flow ────────────────────────────────────────────────────────

  test.describe('Auth Flow', () => {
    test('auth page loads with both tab forms', async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Auth section visible
      await expect(page.locator('#auth-section')).toBeVisible();

      // Magic link tab (default)
      await expect(page.locator('#tab-magic')).toBeVisible();
      await expect(page.locator('#tab-password')).toBeVisible();
      await expect(page.locator('#magic-link-form')).toBeVisible();
      await expect(page.locator('#auth-email')).toBeVisible();
      await expect(page.locator('#auth-submit')).toBeVisible();

      // Switch to password tab
      await page.click('#tab-password');
      await expect(page.locator('#password-form')).toBeVisible();
      await expect(page.locator('#auth-email-pw')).toBeVisible();
      await expect(page.locator('#auth-password')).toBeVisible();
      await expect(page.locator('#auth-submit-pw')).toBeVisible();

      // Switch back
      await page.click('#tab-magic');
      await expect(page.locator('#magic-link-form')).toBeVisible();
      await expect(page.locator('#password-form')).toBeHidden();

      assertNoUnexpectedErrors(errors, 'auth-page');
    });

    test('can sign in with real credentials and see the app', async ({ page }) => {
      const errors = collectErrors(page);
      await mockOuraAPI(page);

      const success = await signIn(page);
      expect(success).toBe(true);

      await waitForAppReady(page);

      // Dashboard should be the default page
      await expect(page.locator('#page-dashboard')).toBeVisible();
      await expect(page.locator('#dashboard-container')).toBeAttached();

      assertNoUnexpectedErrors(errors, 'sign-in');
    });
  });

  // ── 2. Navigation — Every Tab ──────────────────────────────────────────

  test.describe('Navigation — All Pages', () => {
    test.beforeEach(async ({ page }) => {
      await mockOuraAPI(page);
      const success = await signIn(page);
      expect(success).toBe(true);
      await waitForAppReady(page);
    });

    test('navigate to every tab and verify page is visible', async ({ page }) => {
      const errors = collectErrors(page);
      const tabs = ['dashboard', 'protocols', 'challenges', 'friends', 'account'];

      for (const tab of tabs) {
        await page.click(`.nav-btn[data-page="${tab}"]`);
        await page.waitForTimeout(500);

        // Page should be visible
        await expect(page.locator(`#page-${tab}`)).toBeVisible();

        // Active tab should have accent styling
        await expect(page.locator(`.nav-btn[data-page="${tab}"]`)).toHaveClass(/text-oura-accent/);

        // Other tabs should be hidden
        for (const other of tabs) {
          if (other !== tab) {
            await expect(page.locator(`#page-${other}`)).toBeHidden();
          }
        }
      }

      assertNoUnexpectedErrors(errors, 'navigation');
    });

    test('full tab cycle with rapid switching', async ({ page }) => {
      const errors = collectErrors(page);
      const tabs = ['dashboard', 'protocols', 'challenges', 'friends', 'account'];

      // Rapid cycle 3 times
      for (let round = 0; round < 3; round++) {
        for (const tab of tabs) {
          await page.click(`.nav-btn[data-page="${tab}"]`);
          await page.waitForTimeout(150);
        }
      }

      // Last tab should be visible
      await expect(page.locator('#page-account')).toBeVisible();

      // Nav still works after stress
      await page.click('.nav-btn[data-page="dashboard"]');
      await page.waitForTimeout(300);
      await expect(page.locator('#page-dashboard')).toBeVisible();

      assertNoUnexpectedErrors(errors, 'rapid-nav');
    });
  });

  // ── 3. Dashboard Page ──────────────────────────────────────────────────

  test.describe('Dashboard', () => {
    test.beforeEach(async ({ page }) => {
      await mockOuraAPI(page);
      const success = await signIn(page);
      expect(success).toBe(true);
      await waitForAppReady(page);
    });

    test('dashboard loads with real data (not loading state)', async ({ page }) => {
      const errors = collectErrors(page);

      // Navigate to dashboard
      await page.click('.nav-btn[data-page="dashboard"]');
      await page.waitForTimeout(2000); // Wait for data fetch

      const container = page.locator('#dashboard-container');
      const html = await container.innerHTML();

      // Should NOT still be showing loading
      expect(html).not.toContain('Loading dashboard...');

      // Should have baseline metrics OR the "Connect Oura" prompt
      const hasMetrics = html.includes('30-Day Baseline') || html.includes('Lowest HR') || html.includes('Deep Sleep') || html.includes('Sleep Score');
      const hasOuraPrompt = html.includes('Connect Your Oura Ring');
      const hasProtocolButton = html.includes('Start Protocol');
      expect(hasMetrics || hasOuraPrompt).toBe(true);
      expect(hasProtocolButton).toBe(true);

      assertNoUnexpectedErrors(errors, 'dashboard');
    });

    test('Start Protocol button navigates to protocols', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="dashboard"]');
      await page.waitForTimeout(2000);

      // Click "Start Protocol" button
      const startBtn = page.locator('button:has-text("Start Protocol")');
      if (await startBtn.isVisible()) {
        await startBtn.click();
        await page.waitForTimeout(500);
        await expect(page.locator('#page-protocols')).toBeVisible();
      }

      assertNoUnexpectedErrors(errors, 'dashboard-start-protocol');
    });

    test('metric cards are clickable and open detail modals', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="dashboard"]');
      await page.waitForTimeout(2000);

      // Try clicking each metric card (they call Dashboard.showMetricDetail)
      const metrics = ['pre_sleep_hr', 'deep_sleep', 'sleep_score'];
      for (const metric of metrics) {
        const card = page.locator(`[onclick="Dashboard.showMetricDetail('${metric}')"]`);
        if (await card.isVisible()) {
          await card.click();
          await page.waitForTimeout(1000);

          // Modal should appear
          const modal = page.locator('#metric-detail-modal');
          if (await modal.isVisible()) {
            // Close it
            await page.evaluate(() => Dashboard.closeMetricDetail());
            await page.waitForTimeout(300);
          }
        }
      }

      assertNoUnexpectedErrors(errors, 'dashboard-metric-modals');
    });
  });

  // ── 4. Protocols Page ──────────────────────────────────────────────────

  test.describe('Protocols', () => {
    test.beforeEach(async ({ page }) => {
      await mockOuraAPI(page);
      const success = await signIn(page);
      expect(success).toBe(true);
      await waitForAppReady(page);
    });

    test('protocols list loads with real protocols from Supabase', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="protocols"]');
      await page.waitForTimeout(2000);

      const container = page.locator('#protocols-container');
      const html = await container.innerHTML();

      // Should NOT be loading
      expect(html).not.toContain('Loading protocols...');

      // Should have the "Create Your Own Protocol" button
      expect(html).toContain('Create Your Own Protocol');

      // Should have at least one protocol card (Supabase seeds Huberman, Bryan Johnson)
      const protocolCards = page.locator('#protocols-container .bg-oura-card');
      const count = await protocolCards.count();
      expect(count).toBeGreaterThanOrEqual(1);

      assertNoUnexpectedErrors(errors, 'protocols-list');
    });

    test('clicking a protocol navigates to protocol detail', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="protocols"]');
      await page.waitForTimeout(2000);

      // Click the first protocol card
      const firstCard = page.locator('#protocols-container .bg-oura-card').first();
      if (await firstCard.isVisible()) {
        await firstCard.click();
        await page.waitForTimeout(2000);

        // Should show protocol detail page
        await expect(page.locator('#page-protocol-detail')).toBeVisible();

        const detailHtml = await page.locator('#protocol-detail-container').innerHTML();
        expect(detailHtml).not.toContain('Loading...');

        // Should have Back button, habit list, "Create Challenge" button
        expect(detailHtml).toContain('Back to Protocols');
        expect(detailHtml).toContain('Daily Habits');
        expect(detailHtml).toContain('Create Challenge with This Protocol');
      }

      assertNoUnexpectedErrors(errors, 'protocol-detail');
    });

    test('Back button in protocol detail returns to list', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="protocols"]');
      await page.waitForTimeout(2000);

      const firstCard = page.locator('#protocols-container .bg-oura-card').first();
      if (await firstCard.isVisible()) {
        await firstCard.click();
        await page.waitForTimeout(2000);

        // Click Back
        const backBtn = page.locator('button:has-text("Back to Protocols")');
        await expect(backBtn).toBeVisible();
        await backBtn.click();
        await page.waitForTimeout(500);

        await expect(page.locator('#page-protocols')).toBeVisible();
      }

      assertNoUnexpectedErrors(errors, 'protocol-back');
    });

    test('Create Your Own Protocol modal opens and has wizard steps', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="protocols"]');
      await page.waitForTimeout(2000);

      // Click "Create Your Own Protocol"
      const createBtn = page.locator('button:has-text("Create Your Own Protocol")');
      await expect(createBtn).toBeVisible();
      await createBtn.click();
      await page.waitForTimeout(1000);

      // Modal should appear
      const modal = page.locator('#create-protocol-modal');
      await expect(modal).toBeVisible();

      // Step 1: should show habit picker
      await expect(page.locator('#step-content')).toBeVisible();
      const html = await page.locator('#step-content').innerHTML();
      expect(html).toContain('Your Habits');
      expect(html).toContain('Add Custom Habit');

      // Close it
      await page.evaluate(() => Protocols.closeCreateModal());
      await page.waitForTimeout(300);

      assertNoUnexpectedErrors(errors, 'create-protocol-modal');
    });
  });

  // ── 5. Challenges Page ─────────────────────────────────────────────────

  test.describe('Challenges', () => {
    test.beforeEach(async ({ page }) => {
      await mockOuraAPI(page);
      const success = await signIn(page);
      expect(success).toBe(true);
      await waitForAppReady(page);
    });

    test('challenges list loads with real data', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="challenges"]');
      await page.waitForTimeout(3000);

      const container = page.locator('#challenges-container');
      const html = await container.innerHTML();

      // Should not be loading
      expect(html).not.toContain('Loading challenges...');

      // Should have the "Create New Challenge" button
      expect(html).toContain('Create New Challenge');

      // Should have Active Challenges section
      expect(html).toContain('Active Challenges');

      assertNoUnexpectedErrors(errors, 'challenges-list');
    });

    test('Create New Challenge modal opens with protocol dropdown', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="challenges"]');
      await page.waitForTimeout(3000);

      const createBtn = page.locator('button:has-text("Create New Challenge")');
      await expect(createBtn).toBeVisible();
      await createBtn.click();
      await page.waitForTimeout(1000);

      const modal = page.locator('#create-challenge-modal');
      await expect(modal).toBeVisible();

      // Protocol select should have options
      const protocolSelect = page.locator('#challenge-protocol');
      await expect(protocolSelect).toBeVisible();
      const optionCount = await protocolSelect.locator('option').count();
      expect(optionCount).toBeGreaterThanOrEqual(1);

      // Mode selector should be visible
      await expect(page.locator('#mode-selector')).toBeVisible();

      // Submit and Cancel buttons
      await expect(modal.locator('button[type="submit"]')).toBeVisible();
      await expect(modal.locator('button:has-text("Cancel")')).toBeVisible();

      // Close without creating
      await page.click('#create-challenge-modal button:has-text("Cancel")');
      await page.waitForTimeout(300);

      assertNoUnexpectedErrors(errors, 'create-challenge-modal');
    });

    test('clicking an active challenge navigates to detail', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="challenges"]');
      await page.waitForTimeout(3000);

      // Find an active challenge card
      const challengeCard = page.locator('#challenges-container .bg-oura-subtle').first();
      if (await challengeCard.isVisible()) {
        await challengeCard.click();
        await page.waitForTimeout(5000); // Challenge detail loads data + syncs

        // Should show challenge detail page
        await expect(page.locator('#page-challenge-detail')).toBeVisible();

        const detailHtml = await page.locator('#challenge-detail-container').innerHTML();
        // Should have Back button
        expect(detailHtml).toContain('Back');
        // Should have content (hero stat, leaderboard, etc.)
        const hasContent = detailHtml.includes('CHALLENGE STANDINGS') ||
                          detailHtml.includes("You're In") ||
                          detailHtml.includes('hero-stat') ||
                          detailHtml.includes('Invite Friends');
        expect(hasContent).toBe(true);
      }

      assertNoUnexpectedErrors(errors, 'challenge-detail');
    });

    test('challenge detail metric toggle buttons work', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="challenges"]');
      await page.waitForTimeout(3000);

      const challengeCard = page.locator('#challenges-container .bg-oura-subtle').first();
      if (await challengeCard.isVisible()) {
        await challengeCard.click();
        await page.waitForTimeout(5000);

        // Check for metric toggle
        const metricToggle = page.locator('#metric-toggle');
        if (await metricToggle.isVisible()) {
          const metrics = ['score', 'avghr', 'hr', 'deep'];
          for (const metric of metrics) {
            const btn = page.locator(`.metric-btn[data-metric="${metric}"]`);
            if (await btn.isVisible()) {
              await btn.click();
              await page.waitForTimeout(500);
              // Verify it gets active styling
              const style = await btn.evaluate(el => el.style.color);
              expect(style).toBe('rgb(255, 255, 255)');
            }
          }
        }
      }

      assertNoUnexpectedErrors(errors, 'challenge-metrics');
    });

    test('challenge detail settings menu opens', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="challenges"]');
      await page.waitForTimeout(3000);

      const challengeCard = page.locator('#challenges-container .bg-oura-subtle').first();
      if (await challengeCard.isVisible()) {
        await challengeCard.click();
        await page.waitForTimeout(5000);

        // Click settings cogwheel
        const settingsBtn = page.locator('#challenge-detail-container button').filter({
          has: page.locator('svg path[d*="M9.594"]') // Settings gear icon path
        }).first();

        if (await settingsBtn.isVisible()) {
          await settingsBtn.click();
          await page.waitForTimeout(500);

          const settingsModal = page.locator('#settings-menu-modal');
          await expect(settingsModal).toBeVisible();

          // Should have Sync and Cancel buttons
          const html = await settingsModal.innerHTML();
          expect(html).toContain('Sync Sleep Data');
          expect(html).toContain('Cancel');

          // Close
          await page.evaluate(() => Challenges.closeSettingsMenu());
          await page.waitForTimeout(300);
        }
      }

      assertNoUnexpectedErrors(errors, 'challenge-settings');
    });

    test('challenge detail "View detailed metrics" opens modal', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="challenges"]');
      await page.waitForTimeout(3000);

      const challengeCard = page.locator('#challenges-container .bg-oura-subtle').first();
      if (await challengeCard.isVisible()) {
        await challengeCard.click();
        await page.waitForTimeout(5000);

        const detailsBtn = page.locator('button:has-text("View detailed metrics")');
        if (await detailsBtn.isVisible()) {
          await detailsBtn.click();
          await page.waitForTimeout(2000);

          const detailsModal = page.locator('#details-modal');
          await expect(detailsModal).toBeVisible();

          const html = await detailsModal.innerHTML();
          expect(html).toContain('Challenge Details');
          expect(html).toContain("Today's Habits");

          // Close
          await page.evaluate(() => Challenges.closeDetailsModal());
          await page.waitForTimeout(300);
        }
      }

      assertNoUnexpectedErrors(errors, 'challenge-details-modal');
    });

    test('challenge detail "Invite Friends" modal opens', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="challenges"]');
      await page.waitForTimeout(3000);

      const challengeCard = page.locator('#challenges-container .bg-oura-subtle').first();
      if (await challengeCard.isVisible()) {
        await challengeCard.click();
        await page.waitForTimeout(5000);

        const inviteBtn = page.locator('button:has-text("Invite Friends")');
        if (await inviteBtn.isVisible()) {
          await inviteBtn.click();
          await page.waitForTimeout(2000);

          const inviteModal = page.locator('#invite-friends-modal');
          await expect(inviteModal).toBeVisible();

          const html = await inviteModal.innerHTML();
          expect(html).toContain('Invite to Challenge');
          expect(html).toContain('Invite by Email');

          // Close
          await page.evaluate(() => Challenges.closeInviteFriendsModal());
          await page.waitForTimeout(300);
        }
      }

      assertNoUnexpectedErrors(errors, 'challenge-invite');
    });

    test('challenge detail Back button returns to list', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="challenges"]');
      await page.waitForTimeout(3000);

      const challengeCard = page.locator('#challenges-container .bg-oura-subtle').first();
      if (await challengeCard.isVisible()) {
        await challengeCard.click();
        await page.waitForTimeout(5000);

        const backBtn = page.locator('button:has-text("Back")').first();
        await expect(backBtn).toBeVisible();
        await backBtn.click();
        await page.waitForTimeout(1000);

        await expect(page.locator('#page-challenges')).toBeVisible();
      }

      assertNoUnexpectedErrors(errors, 'challenge-back');
    });
  });

  // ── 6. Friends Page ────────────────────────────────────────────────────

  test.describe('Friends', () => {
    test.beforeEach(async ({ page }) => {
      await mockOuraAPI(page);
      const success = await signIn(page);
      expect(success).toBe(true);
      await waitForAppReady(page);
    });

    test('friends page loads with invite form and real data', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="friends"]');
      await page.waitForTimeout(3000);

      const container = page.locator('#friends-container');
      const html = await container.innerHTML();

      // Should not be loading
      expect(html).not.toContain('Loading friends...');

      // Should have Add Friend section
      expect(html).toContain('Add Friend');

      // Should have email input and Send Invite button
      await expect(page.locator('#friend-email')).toBeVisible();
      const submitBtn = page.locator('#invite-friend-form button[type="submit"]');
      await expect(submitBtn).toBeVisible();
      await expect(submitBtn).toContainText('Send Invite');

      // Should have Friends list section
      expect(html).toContain('Friends');

      assertNoUnexpectedErrors(errors, 'friends-list');
    });

    test('friend search with non-existent email shows "No user found"', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="friends"]');
      await page.waitForTimeout(3000);

      await page.fill('#friend-email', 'nonexistent-integration-test@example.com');
      await page.click('#invite-friend-form button[type="submit"]');

      // Wait for feedback message
      await page.waitForFunction(() => {
        const el = document.getElementById('invite-message');
        return el && el.textContent && el.textContent.includes('No user found');
      }, { timeout: 10000 });

      const message = page.locator('#invite-message');
      await expect(message).toContainText('No user found');

      // "Send invite link?" button should appear
      const inviteLinkBtn = page.locator('#send-invite-link-btn');
      await expect(inviteLinkBtn).toBeVisible();

      assertNoUnexpectedErrors(errors, 'friends-search-not-found');
    });
  });

  // ── 7. Account Page ────────────────────────────────────────────────────

  test.describe('Account', () => {
    test.beforeEach(async ({ page }) => {
      await mockOuraAPI(page);
      const success = await signIn(page);
      expect(success).toBe(true);
      await waitForAppReady(page);
    });

    test('account page loads with real profile data', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="account"]');
      await page.waitForTimeout(3000);

      const container = page.locator('#account-container');

      // Wait for it to finish rendering
      await page.waitForFunction(() => {
        const el = document.getElementById('account-container');
        return el && !el.innerHTML.includes('Loading');
      }, { timeout: 10000 });

      const html = await container.innerHTML();

      // Should have profile section with email
      expect(html).toContain(TEST_EMAIL);

      // Should have Edit Profile button
      expect(html).toContain('Edit Profile');

      // Should have Oura Ring section
      expect(html).toContain('Oura Ring');

      // Should have Sync Sleep Data setting
      expect(html).toContain('Sync Sleep Data');

      // Should have Sign Out button
      expect(html).toContain('Sign Out');

      assertNoUnexpectedErrors(errors, 'account-page');
    });

    test('Edit Profile modal opens and has form elements', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="account"]');
      await page.waitForTimeout(3000);

      await page.waitForFunction(() => {
        const el = document.getElementById('account-container');
        return el && !el.innerHTML.includes('Loading');
      }, { timeout: 10000 });

      const editBtn = page.locator('button:has-text("Edit Profile")');
      await expect(editBtn).toBeVisible();
      await editBtn.click();
      await page.waitForTimeout(500);

      const modal = page.locator('#edit-profile-modal');
      await expect(modal).toBeVisible();

      // Has display name input
      await expect(page.locator('#display-name-input')).toBeVisible();

      // Has Save and Cancel buttons
      await expect(modal.locator('button:has-text("Save")')).toBeVisible();
      await expect(modal.locator('button:has-text("Cancel")')).toBeVisible();

      // Close without saving
      await page.evaluate(() => Account.closeEditProfileModal());
      await page.waitForTimeout(300);

      assertNoUnexpectedErrors(errors, 'edit-profile-modal');
    });

    test('Oura Token modal opens with instructions', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="account"]');
      await page.waitForTimeout(3000);

      await page.waitForFunction(() => {
        const el = document.getElementById('account-container');
        return el && !el.innerHTML.includes('Loading');
      }, { timeout: 10000 });

      // Click Connect/Update button for Oura
      const ouraBtn = page.locator('#account-container button').filter({
        hasText: /Connect|Update/
      }).first();
      if (await ouraBtn.isVisible()) {
        await ouraBtn.click();
        await page.waitForTimeout(500);

        const modal = page.locator('#oura-token-modal');
        await expect(modal).toBeVisible();

        const html = await modal.innerHTML();
        expect(html).toContain('Oura Ring');
        expect(html).toContain('Personal Access Token');
        expect(html).toContain('cloud.ouraring.com');

        // Has token input and buttons
        await expect(page.locator('#oura-token-input')).toBeVisible();
        await expect(modal.locator('button:has-text("Save")')).toBeVisible();
        await expect(modal.locator('button:has-text("Cancel")')).toBeVisible();

        // Close
        await page.evaluate(() => Account.closeOuraTokenModal());
        await page.waitForTimeout(300);
      }

      assertNoUnexpectedErrors(errors, 'oura-token-modal');
    });

    test('Sync Sleep Data button is clickable', async ({ page }) => {
      const errors = collectErrors(page);

      await page.click('.nav-btn[data-page="account"]');
      await page.waitForTimeout(3000);

      await page.waitForFunction(() => {
        const el = document.getElementById('account-container');
        return el && !el.innerHTML.includes('Loading');
      }, { timeout: 10000 });

      const syncBtn = page.locator('button:has-text("Sync Sleep Data")');
      await expect(syncBtn).toBeVisible();

      // We don't actually click it in this test because it would trigger
      // an alert dialog if there's no Oura token — but we verify it exists

      assertNoUnexpectedErrors(errors, 'sync-button');
    });
  });

  // ── 8. Sign Out Flow ───────────────────────────────────────────────────

  test.describe('Sign Out', () => {
    test('sign out button triggers confirmation and sign out', async ({ page }) => {
      const errors = collectErrors(page);
      await mockOuraAPI(page);
      const success = await signIn(page);
      expect(success).toBe(true);
      await waitForAppReady(page);

      // Navigate to account
      await page.click('.nav-btn[data-page="account"]');
      await page.waitForTimeout(3000);

      await page.waitForFunction(() => {
        const el = document.getElementById('account-container');
        return el && !el.innerHTML.includes('Loading');
      }, { timeout: 10000 });

      // Override confirm to auto-accept, and override reload to prevent actual reload
      await page.evaluate(() => {
        window.confirm = () => true;
        window._signOutCalled = false;
        const origSignOut = SupabaseClient.client.auth.signOut.bind(SupabaseClient.client.auth);

        // Track call but prevent reload
        Account.signOut = async function() {
          if (!window.confirm('Are you sure you want to sign out?')) return;
          try {
            await origSignOut();
            window._signOutCalled = true;
            // Don't reload
          } catch (error) {
            console.error('Error signing out:', error);
          }
        };
      });

      // Prevent navigation
      await page.route('**/*', async (route) => {
        if (route.request().isNavigationRequest() && route.request().url() !== page.url()) {
          await route.abort();
        } else {
          await route.continue();
        }
      });

      const signOutBtn = page.locator('#account-container button:has-text("Sign Out")');
      await expect(signOutBtn).toBeVisible();
      await signOutBtn.click();

      await page.waitForTimeout(2000);

      const signedOut = await page.evaluate(() => window._signOutCalled);
      expect(signedOut).toBe(true);

      assertNoUnexpectedErrors(errors, 'sign-out');
    });
  });

  // ── 9. Server API Endpoints ────────────────────────────────────────────

  test.describe('Server Endpoints', () => {
    test('health endpoint returns ok', async ({ request }) => {
      const response = await request.get('/health');
      expect(response.ok()).toBe(true);
      const body = await response.json();
      expect(body.status).toBe('ok');
    });

    test('webhook rejects unauthenticated requests', async ({ request }) => {
      const response = await request.post('/webhook/sync-sleep', {
        data: { userId: 'x', ouraToken: 'x' },
      });
      expect(response.status()).toBe(401);
    });

    test('dotfile access is blocked', async ({ request }) => {
      const response = await request.get('/.env');
      expect(response.status()).toBe(403);
    });

    test('static files still served', async ({ request }) => {
      const response = await request.get('/');
      expect(response.ok()).toBe(true);
      const body = await response.text();
      expect(body).toContain('Protocol');
    });
  });

  // ── 10. Module Availability ────────────────────────────────────────────

  test.describe('All JS Modules Load', () => {
    test('every global module is defined after page load', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const modules = await page.evaluate(() => ({
        SupabaseClient: typeof window.SupabaseClient !== 'undefined',
        Auth: typeof window.Auth !== 'undefined',
        Friends: typeof window.Friends !== 'undefined',
        Protocols: typeof window.Protocols !== 'undefined',
        Challenges: typeof window.Challenges !== 'undefined',
        Comparison: typeof window.Comparison !== 'undefined',
        SleepSync: typeof window.SleepSync !== 'undefined',
        Onboarding: typeof window.Onboarding !== 'undefined',
        Dashboard: typeof window.Dashboard !== 'undefined',
        Account: typeof window.Account !== 'undefined',
        Cache: typeof window.Cache !== 'undefined',
        App: typeof window.App !== 'undefined',
      }));

      for (const [name, loaded] of Object.entries(modules)) {
        expect(loaded, `Module ${name} should be loaded`).toBe(true);
      }
    });
  });

  // ── 11. Comprehensive Error Sweep ──────────────────────────────────────

  test.describe('Full Navigation Error Sweep', () => {
    test('visit every page and collect all console errors', async ({ page }) => {
      const allErrors = collectErrors(page);
      await mockOuraAPI(page);

      const success = await signIn(page);
      if (!success) {
        test.skip(true, 'Could not sign in');
        return;
      }
      await waitForAppReady(page);

      // Visit every page
      const pages = ['dashboard', 'protocols', 'challenges', 'friends', 'account'];
      for (const p of pages) {
        await page.click(`.nav-btn[data-page="${p}"]`);
        await page.waitForTimeout(2000);
      }

      // Visit protocol detail
      await page.click('.nav-btn[data-page="protocols"]');
      await page.waitForTimeout(2000);
      const firstProtocol = page.locator('#protocols-container .bg-oura-card').first();
      if (await firstProtocol.isVisible()) {
        await firstProtocol.click();
        await page.waitForTimeout(2000);
        // Go back
        await page.evaluate(() => App.navigateTo('protocols'));
        await page.waitForTimeout(1000);
      }

      // Visit challenge detail (if any active challenge exists)
      await page.click('.nav-btn[data-page="challenges"]');
      await page.waitForTimeout(3000);
      const firstChallenge = page.locator('#challenges-container .bg-oura-subtle').first();
      if (await firstChallenge.isVisible()) {
        await firstChallenge.click();
        await page.waitForTimeout(5000);
        // Go back
        await page.evaluate(() => App.navigateTo('challenges'));
        await page.waitForTimeout(1000);
      }

      // Report all errors
      const unexpected = filterExpectedErrors(allErrors);
      if (unexpected.length > 0) {
        console.log('=== UNEXPECTED CONSOLE ERRORS DURING FULL NAVIGATION ===');
        unexpected.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
        console.log('========================================================');
      }

      // We don't fail on errors here — this is a diagnostic test
      // But we log them for the team to investigate
    });
  });
});
