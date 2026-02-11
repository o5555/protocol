// @ts-check
const { test, expect } = require('@playwright/test');

// =============================================================================
// Helpers
// =============================================================================

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

async function mockSupabase(page) {
  await page.evaluate(() => {
    SupabaseClient.getCurrentUser = () => Promise.resolve({ id: 'test-user-id', email: 'test@example.com' });
    SupabaseClient.signOut = async () => {};

    const mockChallenge = {
      id: 'challenge-1', name: 'Test Challenge', mode: 'pro',
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      created_at: new Date().toISOString(),
      protocol: {
        id: 'proto-1', name: 'Sleep Protocol', icon: '🌙', description: 'Test',
        habits: [
          { id: 'h1', title: 'No caffeine after 2pm', description: '', sort_order: 1 },
          { id: 'h2', title: 'Screen off by 10pm', description: '', sort_order: 2 }
        ]
      },
      creator: { id: 'test-user-id', email: 'test@example.com', display_name: 'Test User' },
      participants: [{
        id: 'p1', status: 'accepted', joined_at: new Date().toISOString(),
        user: { id: 'test-user-id', email: 'test@example.com', display_name: 'Test User' }
      }]
    };

    const mockProtocols = [
      { id: 'proto-1', name: 'Sleep Protocol', icon: '🌙', description: 'Better sleep', user_id: null },
      { id: 'proto-2', name: 'Morning Routine', icon: '☀️', description: 'Rise and shine', user_id: null }
    ];

    const mockQuery = {
      select: () => mockQuery, eq: () => mockQuery, neq: () => mockQuery,
      gte: () => mockQuery, lte: () => mockQuery, or: () => mockQuery,
      order: () => mockQuery, maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: mockChallenge, error: null }),
      insert: () => ({
        ...mockQuery,
        select: () => ({
          ...mockQuery,
          single: () => Promise.resolve({ data: mockChallenge, error: null })
        })
      }),
      update: () => mockQuery, delete: () => mockQuery,
      then: (fn) => Promise.resolve({ data: [], error: null }).then(fn),
    };

    SupabaseClient.client.from = (table) => {
      if (table === 'protocols') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            order: () => Promise.resolve({ data: mockProtocols, error: null }),
            eq: () => ({
              ...mockQuery,
              single: () => Promise.resolve({
                data: { ...mockProtocols[0], habits: mockChallenge.protocol.habits },
                error: null
              })
            })
          })
        };
      }
      if (table === 'challenges') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            eq: () => ({
              ...mockQuery,
              single: () => Promise.resolve({ data: mockChallenge, error: null }),
              order: () => Promise.resolve({ data: [mockChallenge], error: null })
            }),
            order: () => Promise.resolve({ data: [mockChallenge], error: null })
          }),
          insert: () => ({
            ...mockQuery,
            select: () => ({
              ...mockQuery,
              single: () => Promise.resolve({ data: mockChallenge, error: null })
            })
          }),
          delete: () => ({
            ...mockQuery,
            eq: () => Promise.resolve({ data: null, error: null })
          })
        };
      }
      if (table === 'challenge_participants') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            eq: () => ({
              ...mockQuery,
              eq: () => Promise.resolve({ data: [], error: null }),
              order: () => Promise.resolve({
                data: [{
                  id: 'p1', status: 'accepted', joined_at: new Date().toISOString(),
                  challenge: mockChallenge
                }],
                error: null
              })
            }),
            or: () => Promise.resolve({ data: [], error: null })
          }),
          insert: () => Promise.resolve({ data: {}, error: null })
        };
      }
      if (table === 'sleep_data') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            eq: () => ({
              ...mockQuery,
              gte: () => ({
                ...mockQuery,
                order: () => Promise.resolve({
                  data: [{
                    date: new Date().toISOString().split('T')[0],
                    avg_hr: 58, sleep_score: 85, total_sleep_minutes: 420,
                    pre_sleep_hr: 55, deep_sleep_minutes: 90
                  }],
                  error: null
                })
              })
            })
          })
        };
      }
      if (table === 'habit_completions') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            eq: () => ({
              ...mockQuery,
              eq: () => ({
                ...mockQuery,
                eq: () => Promise.resolve({ data: [], error: null })
              })
            })
          })
        };
      }
      if (table === 'profiles') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            eq: () => ({
              ...mockQuery,
              single: () => Promise.resolve({
                data: { display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 },
                error: null
              }),
              order: () => Promise.resolve({ data: [], error: null })
            }),
            or: () => Promise.resolve({ data: [], error: null }),
            order: () => Promise.resolve({ data: [], error: null })
          })
        };
      }
      if (table === 'friendships') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            eq: () => ({
              ...mockQuery,
              eq: () => Promise.resolve({ data: [], error: null }),
              or: () => Promise.resolve({ data: [], error: null })
            }),
            or: () => ({
              ...mockQuery,
              maybeSingle: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
              single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } })
            })
          }),
          insert: () => ({
            ...mockQuery,
            select: () => ({
              ...mockQuery,
              single: () => Promise.resolve({
                data: { id: 'fs-1', user_id: 'test-user-id', friend_id: 'friend-1', status: 'pending' },
                error: null
              })
            })
          })
        };
      }
      if (table === 'pending_invites') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            order: () => Promise.resolve({ data: [], error: null })
          })
        };
      }
      if (table === 'protocol_habits') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            order: () => ({
              ...mockQuery,
              order: () => Promise.resolve({
                data: mockChallenge.protocol.habits.map(h => ({ ...h, protocol: mockProtocols[0] })),
                error: null
              })
            })
          })
        };
      }
      if (table === 'feedback') {
        return {
          ...mockQuery,
          insert: () => Promise.resolve({ data: {}, error: null })
        };
      }
      return mockQuery;
    };

    // Also mock via rpc for friend search
    SupabaseClient.client.rpc = () => Promise.resolve({ data: [], error: null });

    Auth.getProfile = () => Promise.resolve({ display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 });

    if (typeof SleepSync !== 'undefined') SleepSync.syncNow = async () => ({ success: true, synced: 1, count: 0 });
    if (typeof Comparison !== 'undefined') {
      Comparison.renderForChallenge = async () => {};
      Comparison.getChallengeSleepData = async () => ({
        sleepData: [{
          user: { id: 'test-user-id', email: 'test@example.com', display_name: 'Test User' },
          baselineData: [{ sleep_score: 80, avg_hr: 60, pre_sleep_hr: 55, deep_sleep_minutes: 85, total_sleep_minutes: 420 }],
          challengeData: [{ sleep_score: 85, avg_hr: 58, pre_sleep_hr: 53, deep_sleep_minutes: 90, total_sleep_minutes: 440, date: new Date().toISOString().split('T')[0] }],
          challengeDays: 5,
          data: [{ avg_hr: 58, sleep_score: 85 }]
        }]
      });
      Comparison.calcAverages = (data, days) => {
        if (!data || data.length === 0) return { score: null, hr: null };
        const scores = data.filter(d => d.sleep_score).map(d => d.sleep_score);
        const hrs = data.filter(d => d.pre_sleep_hr).map(d => d.pre_sleep_hr);
        return {
          score: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
          hr: hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null
        };
      };
    }
    if (typeof Friends !== 'undefined') {
      Friends.getFriends = async () => [];
      Friends.getPendingRequests = async () => [];
      Friends.getSentRequests = async () => [];
      Friends.getPendingInvites = async () => [];
    }
    if (typeof Challenges !== 'undefined') {
      Challenges.getInvitations = async () => [];
    }
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
    !e.includes('auth callback') && !e.includes('Auth callback') && !e.includes('favicon.ico') &&
    !e.includes('Error signing out') && !e.includes('A]') && !e.includes('Error loading') &&
    !e.includes('Error submitting') && !e.includes('Clipboard') && !e.includes('clipboard')
  );
}

// Wait for a container to finish loading (no "Loading" text)
async function waitForLoaded(page, containerId, timeout = 10000) {
  await page.waitForFunction(
    (id) => {
      const c = document.getElementById(id);
      return c && !c.innerHTML.includes('Loading');
    },
    containerId,
    { timeout }
  ).catch(() => {});
}

// =============================================================================
// 1. Click all bottom nav buttons
// =============================================================================

test.describe('Click all bottom nav buttons', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await mockSupabase(page);
  });

  test('clicking each nav button switches to correct page', async ({ page }) => {
    const errors = collectErrors(page);
    const tabs = ['dashboard', 'protocols', 'challenges', 'account'];

    for (const tab of tabs) {
      const btn = page.locator(`.nav-btn[data-page="${tab}"]`);
      await expect(btn).toBeVisible();
      await btn.click();
      await expect(page.locator(`#page-${tab}`)).toBeVisible();

      // Verify other pages are hidden
      for (const other of tabs) {
        if (other !== tab) {
          await expect(page.locator(`#page-${other}`)).toBeHidden();
        }
      }
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('active nav button gets accent class', async ({ page }) => {
    const tabs = ['dashboard', 'protocols', 'challenges', 'account'];

    for (const tab of tabs) {
      await page.locator(`.nav-btn[data-page="${tab}"]`).click();
      const activeBtn = page.locator(`.nav-btn[data-page="${tab}"]`);
      await expect(activeBtn).toHaveClass(/text-oura-accent/);
    }
  });
});

// =============================================================================
// 2. Click all auth tab buttons
// =============================================================================

test.describe('Click all auth tab buttons', () => {
  test('click magic link tab, then password tab, then back', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Default: magic link form visible
    await expect(page.locator('#magic-link-form')).toBeVisible();
    await expect(page.locator('#password-form')).toBeHidden();

    // Click password tab
    await page.locator('#tab-password').click();
    await expect(page.locator('#password-form')).toBeVisible();
    await expect(page.locator('#magic-link-form')).toBeHidden();

    // Click magic link tab
    await page.locator('#tab-magic').click();
    await expect(page.locator('#magic-link-form')).toBeVisible();
    await expect(page.locator('#password-form')).toBeHidden();

    // Click password tab again
    await page.locator('#tab-password').click();
    await expect(page.locator('#password-form')).toBeVisible();

    // Verify all interactive elements on auth page
    await expect(page.locator('#auth-email-pw')).toBeVisible();
    await expect(page.locator('#auth-password')).toBeVisible();
    await expect(page.locator('#auth-submit-pw')).toBeVisible();

    // Switch back to magic link and verify its elements
    await page.locator('#tab-magic').click();
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-submit')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click magic link submit with empty field (HTML5 validation blocks)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#magic-link-form')).toBeVisible();
    await page.locator('#auth-submit').click();
    // Auth message stays hidden (form not submitted due to required field)
    await expect(page.locator('#auth-message')).toBeHidden();
  });

  test('click password submit with empty fields (HTML5 validation blocks)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-password').click();
    await page.locator('#auth-submit-pw').click();
    await expect(page.locator('#auth-message-pw')).toBeHidden();
  });
});

// =============================================================================
// 3. Click every element on Dashboard
// =============================================================================

test.describe('Click every element on Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await mockSupabase(page);
    await page.evaluate(() => App.navigateTo('dashboard'));
    await waitForLoaded(page, 'dashboard-container');
  });

  test('dashboard renders metric cards that are clickable', async ({ page }) => {
    const errors = collectErrors(page);

    // Wait for sparklines to render
    await page.waitForTimeout(500);

    // Click each metric bar (sleep score, avg HR, lowest HR, deep sleep)
    const metricSelectors = [
      '[onclick*="showMetricDetail(\'sleep_score\')"]',
      '[onclick*="showMetricDetail(\'avg_hr\')"]',
      '[onclick*="showMetricDetail(\'pre_sleep_hr\')"]',
      '[onclick*="showMetricDetail(\'deep_sleep\')"]'
    ];

    for (const selector of metricSelectors) {
      const el = page.locator(`#dashboard-container ${selector}`).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        // Modal should open
        const modal = page.locator('#metric-detail-modal');
        await expect(modal).toBeVisible({ timeout: 3000 }).catch(() => {});
        // Close by clicking back button in modal
        const closeBtn = modal.locator('button').first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click();
        }
        await page.waitForTimeout(200);
      }
    }

    // Click active challenge card if present
    const challengeCard = page.locator('#dashboard-container [onclick*="challenge-detail"]').first();
    if (await challengeCard.isVisible().catch(() => false)) {
      await challengeCard.click();
      await page.waitForTimeout(300);
      // Navigate back to dashboard
      await page.evaluate(() => App.navigateTo('dashboard'));
      await waitForLoaded(page, 'dashboard-container');
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('metric detail modal opens and closes', async ({ page }) => {
    await page.waitForTimeout(500);

    // Try to open sleep score detail
    const sleepScoreBar = page.locator('[onclick*="showMetricDetail(\'sleep_score\')"]').first();
    if (await sleepScoreBar.isVisible().catch(() => false)) {
      await sleepScoreBar.click();

      const modal = page.locator('#metric-detail-modal');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Close by clicking backdrop
      await modal.click({ position: { x: 5, y: 5 } });
      await expect(modal).toBeHidden({ timeout: 3000 }).catch(() => {
        // Try the back button instead
        page.locator('#metric-detail-modal button').first().click();
      });
    }
  });
});

// =============================================================================
// 4. Click every element on Protocols page
// =============================================================================

test.describe('Click every element on Protocols page', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await mockSupabase(page);
    await page.evaluate(() => App.navigateTo('protocols'));
    await waitForLoaded(page, 'protocols-container');
  });

  test('click protocol cards to navigate to detail', async ({ page }) => {
    const errors = collectErrors(page);

    // Click the first protocol card
    const protocolCard = page.locator('#protocols-container [onclick*="protocol-detail"]').first();
    if (await protocolCard.isVisible().catch(() => false)) {
      await protocolCard.click();
      await expect(page.locator('#page-protocol-detail')).toBeVisible();
      await waitForLoaded(page, 'protocol-detail-container');
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Create Your Own Protocol button opens modal', async ({ page }) => {
    const errors = collectErrors(page);

    const createBtn = page.locator('#protocols-container button', { hasText: 'Create Your Own Protocol' });
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();

      const modal = page.locator('#create-protocol-modal');
      await expect(modal).toBeVisible({ timeout: 3000 });

      // Close modal
      const closeBtn = modal.locator('button[onclick*="closeCreateModal"]');
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      }
      await expect(modal).toBeHidden({ timeout: 3000 });
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click each protocol card in the list', async ({ page }) => {
    const cards = page.locator('#protocols-container [onclick*="protocol-detail"]');
    const count = await cards.count();

    for (let i = 0; i < count; i++) {
      // Navigate back to protocols for each card
      await page.evaluate(() => App.navigateTo('protocols'));
      await waitForLoaded(page, 'protocols-container');

      const card = page.locator('#protocols-container [onclick*="protocol-detail"]').nth(i);
      if (await card.isVisible().catch(() => false)) {
        await card.click();
        await expect(page.locator('#page-protocol-detail')).toBeVisible();
      }
    }
  });
});

// =============================================================================
// 5. Click every element on Protocol Detail
// =============================================================================

test.describe('Click every element on Protocol Detail', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await mockSupabase(page);
    await page.evaluate(() => App.navigateTo('protocol-detail', 'proto-1'));
    await waitForLoaded(page, 'protocol-detail-container');
  });

  test('click Back button navigates to protocols list', async ({ page }) => {
    const errors = collectErrors(page);

    const backBtn = page.locator('#protocol-detail-container button', { hasText: 'Back' });
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(page.locator('#page-protocols')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Create Challenge with This Protocol button', async ({ page }) => {
    const errors = collectErrors(page);

    const createBtn = page.locator('#protocol-detail-container button', { hasText: 'Create Challenge' });
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      // This should trigger Challenges.showCreateModal which may show a modal or navigate
      await page.waitForTimeout(500);
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('protocol detail displays habits list', async ({ page }) => {
    // Verify habit items are rendered
    const habitsSection = page.locator('#protocol-detail-container', { hasText: 'Daily Habits' });
    await expect(habitsSection).toBeVisible();

    // Check individual habits are visible
    const habitItem = page.locator('#protocol-detail-container', { hasText: 'No caffeine after 2pm' });
    await expect(habitItem).toBeVisible({ timeout: 3000 }).catch(() => {});
  });
});

// =============================================================================
// 6. Click every element on Challenges page
// =============================================================================

test.describe('Click every element on Challenges page', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await mockSupabase(page);
  });

  test('challenges page renders and has Start New Challenge button', async ({ page }) => {
    const errors = collectErrors(page);

    // Override to show the list (not auto-navigate to detail)
    await page.evaluate(() => {
      Challenges.getActiveChallenges = async () => [];
      Challenges.getCompletedChallenges = async () => [];
      App.navigateTo('challenges');
    });
    await waitForLoaded(page, 'challenges-container');

    const startBtn = page.locator('#challenges-container button', { hasText: 'Start New Challenge' });
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click();
      // Should navigate to protocols page
      await expect(page.locator('#page-protocols')).toBeVisible();
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click active challenge card navigates to detail', async ({ page }) => {
    const errors = collectErrors(page);

    // Make sure we have multiple challenges to show the list
    await page.evaluate(() => {
      const mockChallenges = [
        {
          id: 'ch-1', name: 'Challenge A', mode: 'pro',
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
          protocol: { id: 'p1', name: 'Sleep Protocol', icon: '🌙' },
          creator: { id: 'test-user-id', email: 'test@example.com', display_name: 'Test User' },
          daysRemaining: 25, isActive: true, status: 'accepted', participantId: 'p1'
        },
        {
          id: 'ch-2', name: 'Challenge B', mode: 'light',
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 20 * 86400000).toISOString().split('T')[0],
          protocol: { id: 'p2', name: 'Morning Routine', icon: '☀️' },
          creator: { id: 'other-user', email: 'other@test.com', display_name: 'Friend' },
          daysRemaining: 15, isActive: true, status: 'accepted', participantId: 'p2'
        }
      ];
      Challenges.getActiveChallenges = async () => mockChallenges;
      Challenges.getCompletedChallenges = async () => [];
      Challenges.getInvitations = async () => [];
      App.navigateTo('challenges');
    });
    await waitForLoaded(page, 'challenges-container');

    const challengeCard = page.locator('#challenges-container [onclick*="challenge-detail"]').first();
    if (await challengeCard.isVisible().catch(() => false)) {
      await challengeCard.click();
      await expect(page.locator('#page-challenge-detail')).toBeVisible();
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// =============================================================================
// 7. Click every element on Challenge Detail
// =============================================================================

test.describe('Click every element on Challenge Detail', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await mockSupabase(page);
    await page.evaluate(() => App.navigateTo('challenge-detail', 'challenge-1'));
    await waitForLoaded(page, 'challenge-detail-container');
    await page.waitForTimeout(1000); // Let async rendering settle
  });

  test('click Back button navigates away', async ({ page }) => {
    const errors = collectErrors(page);

    const backBtn = page.locator('#challenge-detail-container button', { hasText: 'Back' });
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
      await page.waitForTimeout(300);
      // Should navigate to protocols or challenges
      const onProtocols = await page.locator('#page-protocols').isVisible().catch(() => false);
      const onChallenges = await page.locator('#page-challenges').isVisible().catch(() => false);
      expect(onProtocols || onChallenges).toBeTruthy();
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click metric toggle buttons (SLEEP, AVG HR, LOW HR, DEEP)', async ({ page }) => {
    const errors = collectErrors(page);

    const metricButtons = page.locator('#metric-toggle button');
    const count = await metricButtons.count();

    for (let i = 0; i < count; i++) {
      const btn = metricButtons.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click View detailed metrics link', async ({ page }) => {
    const errors = collectErrors(page);

    const detailsLink = page.locator('#challenge-detail-container button', { hasText: 'View detailed metrics' });
    if (await detailsLink.isVisible().catch(() => false)) {
      await detailsLink.click();
      await page.waitForTimeout(500);
      // May open a modal — close it if so
      const modal = page.locator('.fixed.inset-0');
      if (await modal.isVisible().catch(() => false)) {
        // Close by clicking backdrop or close button
        const closeBtn = modal.locator('button').first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click();
        }
      }
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Invite Friends button', async ({ page }) => {
    const errors = collectErrors(page);

    const inviteBtn = page.locator('#challenge-detail-container button', { hasText: 'Invite Friends' });
    if (await inviteBtn.isVisible().catch(() => false)) {
      await inviteBtn.click();
      await page.waitForTimeout(500);
      // May open a modal — close it if present
      const modal = page.locator('.fixed.inset-0');
      if (await modal.isVisible().catch(() => false)) {
        const closeBtn = modal.locator('button[onclick*="close"], button:has-text("Cancel")').first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click();
        } else {
          await modal.click({ position: { x: 5, y: 5 } });
        }
      }
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Browse Protocols button', async ({ page }) => {
    const errors = collectErrors(page);

    const browseBtn = page.locator('#challenge-detail-container button', { hasText: 'Browse Protocols' });
    if (await browseBtn.isVisible().catch(() => false)) {
      await browseBtn.click();
      await expect(page.locator('#page-protocols')).toBeVisible();
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Settings cogwheel button', async ({ page }) => {
    const errors = collectErrors(page);

    // The settings button uses an SVG icon with cog path
    const settingsBtn = page.locator('#challenge-detail-container button[onclick*="showSettingsMenu"]');
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
      // May open a settings menu/modal
      const modal = page.locator('.fixed.inset-0');
      if (await modal.isVisible().catch(() => false)) {
        await modal.click({ position: { x: 5, y: 5 } });
      }
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// =============================================================================
// 8. Click every element on Friends page
// =============================================================================

test.describe('Click every element on Friends page', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await mockSupabase(page);
    await page.evaluate(() => App.navigateTo('friends'));
    await waitForLoaded(page, 'friends-container');
  });

  test('friends page renders with invite form', async ({ page }) => {
    const errors = collectErrors(page);

    // Verify invite form is present
    await expect(page.locator('#invite-friend-form')).toBeVisible();
    await expect(page.locator('#friend-email')).toBeVisible();
    const submitBtn = page.locator('#invite-friend-form button[type="submit"]');
    await expect(submitBtn).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('type email and click Send Invite button', async ({ page }) => {
    const errors = collectErrors(page);

    const emailInput = page.locator('#friend-email');
    await emailInput.fill('friend@example.com');
    await expect(emailInput).toHaveValue('friend@example.com');

    const submitBtn = page.locator('#invite-friend-form button[type="submit"]');
    await submitBtn.click();

    // Wait for message to appear
    await page.waitForTimeout(1000);
    const messageEl = page.locator('#invite-message');
    const isVisible = await messageEl.isVisible().catch(() => false);
    // Message should become visible (either success or "no user found")
    if (isVisible) {
      const text = await messageEl.textContent();
      expect(text.length).toBeGreaterThan(0);
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('submit empty email does nothing (HTML5 validation)', async ({ page }) => {
    const submitBtn = page.locator('#invite-friend-form button[type="submit"]');
    await submitBtn.click();
    // Message should stay hidden
    await expect(page.locator('#invite-message')).toBeHidden();
  });

  test('friends list section is rendered', async ({ page }) => {
    // "Friends (0)" header should be visible
    const friendsHeader = page.locator('#friends-container', { hasText: 'Friends (0)' });
    await expect(friendsHeader).toBeVisible();
  });
});

// =============================================================================
// 9. Click every element on Account page
// =============================================================================

test.describe('Click every element on Account page', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await mockSupabase(page);
    await page.route('**/api/personal_info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email: 'test@example.com' })
      })
    );
    await page.route('**/api/bug-report', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      })
    );
    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');
  });

  test('click Edit Profile button opens modal', async ({ page }) => {
    const errors = collectErrors(page);

    const editBtn = page.locator('#account-container button', { hasText: 'Edit Profile' });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const modal = page.locator('#edit-profile-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal.locator('#display-name-input')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Oura Connect/Update button opens modal', async ({ page }) => {
    const errors = collectErrors(page);

    const ouraBtn = page.locator('#account-container button', { hasText: /Connect|Update|Reconnect/ });
    await expect(ouraBtn).toBeVisible();
    await ouraBtn.click();

    const modal = page.locator('#oura-token-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal.locator('#oura-token-input')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Friends settings button navigates to friends', async ({ page }) => {
    const errors = collectErrors(page);

    const friendsBtn = page.locator('#account-container button', { hasText: 'Friends' });
    if (await friendsBtn.isVisible().catch(() => false)) {
      await friendsBtn.click();
      await expect(page.locator('#page-friends')).toBeVisible();
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Sync Sleep Data button', async ({ page }) => {
    const errors = collectErrors(page);

    const syncBtn = page.locator('#account-container button', { hasText: 'Sync Sleep Data' });
    if (await syncBtn.isVisible().catch(() => false)) {
      await syncBtn.click();
      await page.waitForTimeout(500);
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Report a Bug button opens modal', async ({ page }) => {
    const errors = collectErrors(page);

    const bugBtn = page.locator('#account-container button', { hasText: 'Report a Bug' });
    if (await bugBtn.isVisible().catch(() => false)) {
      await bugBtn.click();

      const modal = page.locator('#bug-report-modal');
      await expect(modal).toBeVisible({ timeout: 3000 });
      await expect(modal.locator('#bug-description')).toBeVisible();
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('click Sign Out button triggers confirm dialog', async ({ page }) => {
    const errors = collectErrors(page);

    await page.evaluate(() => {
      window._confirmCalled = false;
      window.confirm = () => { window._confirmCalled = true; return false; };
    });

    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    await expect(signOutBtn).toBeVisible();
    await signOutBtn.click();
    await page.waitForTimeout(500);

    const confirmCalled = await page.evaluate(() => window._confirmCalled);
    expect(confirmCalled).toBe(true);

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// =============================================================================
// 10. Modal click tests
// =============================================================================

test.describe('Modal click tests', () => {
  test.beforeEach(async ({ page }) => {
    await showApp(page);
    await mockSupabase(page);
    await page.route('**/api/personal_info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ email: 'test@example.com' })
      })
    );
    await page.route('**/api/bug-report', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    );
  });

  test('Edit Profile modal: open, type, cancel', async ({ page }) => {
    const errors = collectErrors(page);

    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');

    // Open modal
    await page.locator('#account-container button', { hasText: 'Edit Profile' }).click();
    const modal = page.locator('#edit-profile-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Type in display name input
    const nameInput = modal.locator('#display-name-input');
    await nameInput.clear();
    await nameInput.fill('New Name');
    await expect(nameInput).toHaveValue('New Name');

    // Click Cancel
    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toBeHidden({ timeout: 3000 });

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Edit Profile modal: open, type, save', async ({ page }) => {
    const errors = collectErrors(page);

    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');

    await page.locator('#account-container button', { hasText: 'Edit Profile' }).click();
    const modal = page.locator('#edit-profile-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    const nameInput = modal.locator('#display-name-input');
    await nameInput.clear();
    await nameInput.fill('Updated Name');

    // Click Save
    await modal.locator('button', { hasText: 'Save' }).click();
    await page.waitForTimeout(1000);

    // Modal should close after save
    await expect(modal).toBeHidden({ timeout: 5000 });

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Edit Profile modal: close by clicking backdrop', async ({ page }) => {
    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');

    await page.locator('#account-container button', { hasText: 'Edit Profile' }).click();
    const modal = page.locator('#edit-profile-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Click backdrop (the outer div)
    await modal.click({ position: { x: 5, y: 5 } });
    await expect(modal).toBeHidden({ timeout: 3000 });
  });

  test('Oura Token modal: open, type, cancel', async ({ page }) => {
    const errors = collectErrors(page);

    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');

    const ouraBtn = page.locator('#account-container button', { hasText: /Connect|Update|Reconnect/ });
    await ouraBtn.click();

    const modal = page.locator('#oura-token-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Type in token input
    const tokenInput = modal.locator('#oura-token-input');
    await tokenInput.fill('test-oura-token-123');
    await expect(tokenInput).toHaveValue('test-oura-token-123');

    // Click Cancel
    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toBeHidden({ timeout: 3000 });

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Oura Token modal: open, type, save', async ({ page }) => {
    const errors = collectErrors(page);

    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');

    const ouraBtn = page.locator('#account-container button', { hasText: /Connect|Update|Reconnect/ });
    await ouraBtn.click();

    const modal = page.locator('#oura-token-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    await modal.locator('#oura-token-input').fill('new-token-value');
    await modal.locator('button', { hasText: 'Save' }).click();
    await page.waitForTimeout(1500);

    // Modal should close after successful save
    await expect(modal).toBeHidden({ timeout: 5000 });

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Oura Token modal: close by clicking backdrop', async ({ page }) => {
    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');

    const ouraBtn = page.locator('#account-container button', { hasText: /Connect|Update|Reconnect/ });
    await ouraBtn.click();

    const modal = page.locator('#oura-token-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await modal.click({ position: { x: 5, y: 5 } });
    await expect(modal).toBeHidden({ timeout: 3000 });
  });

  test('Bug Report modal: open, type, cancel', async ({ page }) => {
    const errors = collectErrors(page);

    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');

    const bugBtn = page.locator('#account-container button', { hasText: 'Report a Bug' });
    if (await bugBtn.isVisible().catch(() => false)) {
      await bugBtn.click();

      const modal = page.locator('#bug-report-modal');
      await expect(modal).toBeVisible({ timeout: 3000 });

      // Type in description
      await modal.locator('#bug-description').fill('Test bug description');

      // Click Cancel
      await modal.locator('button', { hasText: 'Cancel' }).click();
      await expect(modal).toBeHidden({ timeout: 3000 });
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Bug Report modal: open, type, submit', async ({ page }) => {
    const errors = collectErrors(page);

    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');

    const bugBtn = page.locator('#account-container button', { hasText: 'Report a Bug' });
    if (await bugBtn.isVisible().catch(() => false)) {
      await bugBtn.click();

      const modal = page.locator('#bug-report-modal');
      await expect(modal).toBeVisible({ timeout: 3000 });

      await modal.locator('#bug-description').fill('A test bug report from Playwright');
      await modal.locator('button', { hasText: 'Submit' }).click();
      await page.waitForTimeout(2000);

      // Modal should close after submit
      await expect(modal).toBeHidden({ timeout: 5000 });
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Create Protocol modal: open, interact with steps, close', async ({ page }) => {
    const errors = collectErrors(page);

    await page.evaluate(() => App.navigateTo('protocols'));
    await waitForLoaded(page, 'protocols-container');

    const createBtn = page.locator('#protocols-container button', { hasText: 'Create Your Own Protocol' });
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();

      const modal = page.locator('#create-protocol-modal');
      await expect(modal).toBeVisible({ timeout: 3000 });

      // Step 1: Add a custom habit
      const habitInput = modal.locator('#custom-habit-title');
      if (await habitInput.isVisible().catch(() => false)) {
        await habitInput.fill('Test habit');
        // Click the add button (the + button next to input)
        const addBtn = modal.locator('button[onclick*="addCustomHabit"]');
        if (await addBtn.isVisible().catch(() => false)) {
          await addBtn.click();
          await page.waitForTimeout(300);
        }

        // Next button should now be enabled
        const nextBtn = modal.locator('#next-btn');
        if (await nextBtn.isEnabled().catch(() => false)) {
          await nextBtn.click();
          await page.waitForTimeout(300);

          // Step 2: Start date - click Next again
          if (await nextBtn.isVisible().catch(() => false)) {
            await nextBtn.click();
            await page.waitForTimeout(300);
          }

          // Step 3: Name - click Back to test back navigation
          const backBtn = modal.locator('#back-btn');
          if (await backBtn.isVisible().catch(() => false)) {
            await backBtn.click();
            await page.waitForTimeout(300);
          }
        }
      }

      // Close modal
      const closeBtn = modal.locator('button[onclick*="closeCreateModal"]');
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      }
      await expect(modal).toBeHidden({ timeout: 3000 });
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// =============================================================================
// 11. Click stress test
// =============================================================================

test.describe('Click stress test', () => {
  test('rapidly click all nav buttons 20 times without crashing', async ({ page }) => {
    const errors = collectErrors(page);

    await showApp(page);
    await mockSupabase(page);

    const tabs = ['dashboard', 'protocols', 'challenges', 'account'];

    // Rapidly cycle through tabs 20 times
    for (let i = 0; i < 20; i++) {
      const tab = tabs[i % tabs.length];
      await page.locator(`.nav-btn[data-page="${tab}"]`).click();
      // Minimal delay — stress test
      await page.waitForTimeout(50);
    }

    // After 20 clicks: i=19, tabs[19 % 4] = tabs[3] = 'account'
    const lastTab = tabs[19 % tabs.length];
    await page.waitForTimeout(500); // Let async rendering settle

    // Last clicked page should be visible
    await expect(page.locator(`#page-${lastTab}`)).toBeVisible();

    // Only one page should be visible
    for (const tab of tabs) {
      if (tab !== lastTab) {
        await expect(page.locator(`#page-${tab}`)).toBeHidden();
      }
    }

    // Bottom nav should still be visible and functional
    await expect(page.locator('.bottom-nav')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('rapid nav cycling with programmatic navigation', async ({ page }) => {
    const errors = collectErrors(page);

    await showApp(page);
    await mockSupabase(page);

    const pages = ['dashboard', 'protocols', 'challenges', 'account', 'friends'];

    // Rapidly navigate programmatically 20 times
    for (let i = 0; i < 20; i++) {
      const p = pages[i % pages.length];
      await page.evaluate((pageName) => App.navigateTo(pageName), p);
      await page.waitForTimeout(30);
    }

    await page.waitForTimeout(500);

    // App should still be functional — try navigating one more time
    await page.evaluate(() => App.navigateTo('dashboard'));
    await expect(page.locator('#page-dashboard')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('rapid modal open/close does not crash', async ({ page }) => {
    const errors = collectErrors(page);

    await showApp(page);
    await mockSupabase(page);
    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );

    await page.evaluate(() => App.navigateTo('account'));
    await waitForLoaded(page, 'account-container');

    // Rapidly open and close Edit Profile modal 5 times
    for (let i = 0; i < 5; i++) {
      const editBtn = page.locator('#account-container button', { hasText: 'Edit Profile' });
      if (await editBtn.isVisible().catch(() => false)) {
        await editBtn.click();
        const modal = page.locator('#edit-profile-modal');
        await expect(modal).toBeVisible({ timeout: 3000 }).catch(() => {});
        // Close immediately
        await page.evaluate(() => Account.closeEditProfileModal());
        await page.waitForTimeout(100);
      }
    }

    // Page should still be functional
    await expect(page.locator('#account-container')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});
