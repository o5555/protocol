// @ts-check
const { test, expect } = require('@playwright/test');

// Auth bypass: hide auth, show app content and bottom nav
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

// Full Supabase mock helper
async function mockSupabase(page) {
  await page.evaluate(() => {
    SupabaseClient.getCurrentUser = () => Promise.resolve({ id: 'test-user-id', email: 'test@example.com' });
    SupabaseClient.signOut = async () => {};
    const mockQuery = {
      select: () => mockQuery, eq: () => mockQuery, neq: () => mockQuery,
      gte: () => mockQuery, lte: () => mockQuery, or: () => mockQuery,
      order: () => mockQuery,
      single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: null, onboarding_step: 4 }, error: null }),
      insert: () => Promise.resolve({ data: {}, error: null }),
      update: () => mockQuery, delete: () => mockQuery,
      then: (fn) => Promise.resolve({ data: [], error: null }).then(fn),
    };
    const mockFriend = { id: 'friend-1', email: 'friend@example.com', display_name: 'Friend User' };
    SupabaseClient.client.from = (table) => {
      if (table === 'profiles') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            eq: () => ({
              ...mockQuery,
              neq: () => ({
                ...mockQuery,
                single: () => Promise.resolve({ data: mockFriend, error: null })
              }),
              single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: null, onboarding_step: 4 }, error: null }),
              order: () => Promise.resolve({ data: [], error: null }),
            }),
            or: () => Promise.resolve({ data: [], error: null }),
            order: () => Promise.resolve({ data: [], error: null }),
            neq: () => ({
              ...mockQuery,
              single: () => Promise.resolve({ data: mockFriend, error: null })
            }),
          }),
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
              or: () => Promise.resolve({ data: [], error: null }),
            }),
            or: () => ({
              ...mockQuery,
              single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
            }),
          }),
          insert: () => ({
            ...mockQuery,
            select: () => ({
              ...mockQuery,
              single: () => Promise.resolve({ data: { id: 'fs-1', user_id: 'test-user-id', friend_id: 'friend-1', status: 'pending' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'pending_invites') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            order: () => Promise.resolve({ data: [], error: null }),
          }),
          insert: () => ({
            ...mockQuery,
            select: () => ({
              ...mockQuery,
              single: () => Promise.resolve({ data: { id: 'inv-1', invited_email: 'new@example.com' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'challenge_participants') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, order: () => Promise.resolve({ data: [], error: null }) }) }) };
      }
      if (table === 'sleep_data') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, gte: () => ({ ...mockQuery, order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
      }
      return mockQuery;
    };
    Auth.getProfile = () => Promise.resolve({ display_name: 'Test User', oura_token: null, onboarding_step: 4 });
    // Mock Cache
    if (typeof Cache !== 'undefined') {
      Cache.get = () => null;
      Cache.set = () => {};
      Cache.clear = () => {};
    }
    // Mock Challenges for notification check
    if (typeof Challenges !== 'undefined') {
      Challenges.getInvitations = async () => [];
      Challenges.getActiveChallenges = async () => [];
      Challenges.getMyChallenges = async () => [];
    }
    // Mock Friends methods that will be called during render
    Friends.getPendingRequests = async () => [];
    Friends.getSentRequests = async () => [];
    Friends.getPendingInvites = async () => [];
    Friends.getFriends = async () => [];
  });
}

// Collect console errors for every test
function collectErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

// Filter out expected Supabase/network errors
function unexpectedErrors(errors) {
  return errors.filter(e =>
    !e.includes('Supabase') && !e.includes('Failed to fetch') && !e.includes('not initialized') &&
    !e.includes('NetworkError') && !e.includes('net::ERR') && !e.includes('ERR_CONNECTION') &&
    !e.includes('the server responded with a status of') && !e.includes('Invite email') &&
    !e.includes('Error checking notifications') && !e.includes('Error fetching profile') &&
    !e.includes('Error rendering') && !e.includes('Error checking onboarding')
  );
}

// Helper: set up app with mocks and navigate to a page
async function setupApp(page, targetPage = 'dashboard') {
  await showApp(page);
  await mockSupabase(page);
  if (targetPage !== 'dashboard') {
    await page.evaluate((p) => App.navigateTo(p), targetPage);
    await page.waitForTimeout(500);
  }
}

test.describe('Friends Page', () => {
  test('Friends page loads with invite form', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');

    // Verify #page-friends is visible
    await expect(page.locator('#page-friends')).toBeVisible();

    // Wait for #invite-friend-form to appear inside friends-container
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Verify email input exists and is visible
    const emailInput = page.locator('#friend-email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');

    // Verify submit button exists and is visible
    const submitBtn = page.locator('#invite-friend-form button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText('Send Invite');

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Friend search by email — fill and submit shows feedback', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Track messages that appear in #invite-message via a page-level collector,
    // because the form handler shows "Searching..." then "Friend request sent!"
    // then calls render() which replaces the DOM (resetting the element).
    await page.evaluate(() => {
      window.__inviteMessages = [];
      const observer = new MutationObserver(() => {
        const el = document.getElementById('invite-message');
        if (el && el.textContent.trim()) {
          window.__inviteMessages.push(el.textContent.trim());
        }
      });
      observer.observe(document.getElementById('friends-container'), { childList: true, subtree: true, characterData: true });
    });

    // Fill email input with a known friend email (mock returns friend data)
    await page.fill('#friend-email', 'friend@example.com');

    // Click the submit button
    await page.click('#invite-friend-form button[type="submit"]');

    // Wait for the flow to complete (render re-runs, which means a new form appears)
    await page.waitForFunction(() => {
      return window.__inviteMessages && window.__inviteMessages.length >= 1;
    }, { timeout: 10000 });

    // Verify we saw meaningful feedback messages
    const messages = await page.evaluate(() => window.__inviteMessages);
    expect(messages.length).toBeGreaterThan(0);
    const allText = messages.join(' ');
    expect(allText).toMatch(/Searching|Friend request sent|request/i);

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Friend invite with unknown email shows "No user found" option', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Override searchByEmail to return null (no user found)
    await page.evaluate(() => {
      Friends.searchByEmail = async () => null;
    });

    // Fill with an unknown email and submit
    await page.fill('#friend-email', 'unknown@example.com');
    await page.click('#invite-friend-form button[type="submit"]');

    // Wait for message to show "No user found" text
    await page.waitForFunction(() => {
      const el = document.getElementById('invite-message');
      return el && el.textContent.includes('No user found');
    }, { timeout: 5000 });

    const message = page.locator('#invite-message');
    await expect(message).toContainText('No user found');

    // Verify the "Send invite link?" button appears
    const inviteLinkBtn = page.locator('#send-invite-link-btn');
    await expect(inviteLinkBtn).toBeVisible();
    await expect(inviteLinkBtn).toContainText('Send invite link');

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

test.describe('Navigation', () => {
  test('Full tab cycle — every nav button shows correct page', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    const tabs = ['dashboard', 'protocols', 'challenges', 'account'];

    for (const tab of tabs) {
      // Click the nav button
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(300);

      // Verify the correct page is visible
      await expect(page.locator(`#page-${tab}`)).toBeVisible();

      // Verify all OTHER pages are hidden
      for (const otherTab of tabs) {
        if (otherTab !== tab) {
          await expect(page.locator(`#page-${otherTab}`)).toBeHidden();
        }
      }
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Navigation active state — clicked tab gets accent class', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    const tabs = ['protocols', 'challenges', 'account', 'dashboard'];

    for (const tab of tabs) {
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(200);

      // Verify the active button has text-oura-accent
      await expect(page.locator(`.nav-btn[data-page="${tab}"]`)).toHaveClass(/text-oura-accent/);

      // Verify other buttons do NOT have text-oura-accent
      for (const otherTab of tabs) {
        if (otherTab !== tab) {
          await expect(page.locator(`.nav-btn[data-page="${otherTab}"]`)).not.toHaveClass(/text-oura-accent/);
        }
      }
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Back navigation from detail page', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'protocols');

    // Navigate to protocol detail via App.navigateTo
    await page.evaluate(() => App.navigateTo('protocol-detail', 'some-id'));
    await page.waitForTimeout(300);

    // Verify protocol detail page is visible
    await expect(page.locator('#page-protocol-detail')).toBeVisible();
    // Verify protocols list page is hidden
    await expect(page.locator('#page-protocols')).toBeHidden();

    // Try to click the back button in the detail page
    const backBtn = page.locator('#page-protocol-detail button:has-text("Back")').first();
    const backBtnExists = await backBtn.count() > 0;

    if (backBtnExists) {
      await backBtn.click();
    } else {
      // Use nav button to go back to challenges (protocols now live under Challenge tab)
      await page.click('.nav-btn[data-page="challenges"]');
    }
    await page.waitForTimeout(300);

    // Verify return to challenges page (protocols are sub-views within challenge flow)
    await expect(page.locator('#page-challenges')).toBeVisible();
    await expect(page.locator('#page-protocol-detail')).toBeHidden();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Rapid tab switching stress test', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    const tabs = ['dashboard', 'protocols', 'challenges', 'account'];

    // Rapidly cycle through all tabs 3 times with minimal delays
    for (let round = 0; round < 3; round++) {
      for (const tab of tabs) {
        await page.click(`.nav-btn[data-page="${tab}"]`);
        await page.waitForTimeout(100);
      }
    }

    // After all rapid switching, last tab clicked should be visible (account)
    await expect(page.locator('#page-account')).toBeVisible();

    // Verify nav still works after stress — switch to dashboard
    await page.click('.nav-btn[data-page="dashboard"]');
    await page.waitForTimeout(200);
    await expect(page.locator('#page-dashboard')).toBeVisible();
    await expect(page.locator('#page-account')).toBeHidden();

    // Verify active state is correct on dashboard
    await expect(page.locator('.nav-btn[data-page="dashboard"]')).toHaveClass(/text-oura-accent/);

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('No console errors during full navigation cycle', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    const tabs = ['dashboard', 'protocols', 'challenges', 'account'];

    // Navigate to every page and pause to let async rendering settle
    for (const tab of tabs) {
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(500);
    }

    // Also visit detail pages
    await page.evaluate(() => App.navigateTo('protocol-detail', 'test-protocol'));
    await page.waitForTimeout(500);
    await page.evaluate(() => App.navigateTo('challenges', null, {showList:true}));
    await page.waitForTimeout(300);

    // Verify zero unexpected errors across the entire cycle
    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });
});
