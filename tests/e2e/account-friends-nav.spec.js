// @ts-check
const { test, expect } = require('@playwright/test');

// =============================================================================
// Helpers
// =============================================================================

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
      order: () => mockQuery, maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 2 }, error: null }),
      insert: () => Promise.resolve({ data: {}, error: null }),
      update: () => mockQuery, delete: () => mockQuery,
      then: (fn) => Promise.resolve({ data: [], error: null }).then(fn),
    };

    SupabaseClient.client.from = (table) => {
      if (table === 'profiles') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            eq: () => ({
              ...mockQuery,
              single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 2 }, error: null }),
              order: () => Promise.resolve({ data: [], error: null }),
            }),
            or: () => Promise.resolve({ data: [], error: null }),
            order: () => Promise.resolve({ data: [], error: null }),
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
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
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
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
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
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'challenges') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            eq: () => ({
              ...mockQuery,
              order: () => Promise.resolve({ data: [], error: null }),
            }),
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === 'protocols') {
        return {
          ...mockQuery,
          select: () => ({
            ...mockQuery,
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      return mockQuery;
    };

    // Also mock RPC for friend search
    SupabaseClient.client.rpc = () => Promise.resolve({ data: [], error: null });

    Auth.getProfile = () => Promise.resolve({ display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 2 });
    if (typeof SleepSync !== 'undefined') SleepSync.syncNow = async () => ({ success: true, synced: 1 });
    if (typeof Friends !== 'undefined') {
      Friends.getFriends = async () => [];
      Friends.getPendingRequests = async () => [];
      Friends.getSentRequests = async () => [];
      Friends.getPendingInvites = async () => [];
    }
    if (typeof Challenges !== 'undefined') {
      Challenges.getInvitations = async () => [];
      Challenges.getActiveChallenges = async () => [];
      Challenges.getMyChallenges = async () => [];
    }
    if (typeof Cache !== 'undefined') {
      Cache.get = () => null;
      Cache.set = () => {};
      Cache.clear = () => {};
    }
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
    !e.includes('the server responded with a status of') && !e.includes('Invite email') &&
    !e.includes('Error checking notifications') && !e.includes('Error fetching profile') &&
    !e.includes('Error rendering') && !e.includes('Error checking onboarding') &&
    !e.includes('Not authenticated') && !e.includes('Error in smart view') &&
    !e.includes('auth callback') && !e.includes('Auth callback') && !e.includes('Error signing out') &&
    !e.includes('favicon.ico') && !e.includes('A]')
  );
}

async function setupApp(page, targetPage = 'dashboard') {
  await showApp(page);
  await mockSupabase(page);
  await page.route('**/api/personal_info', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ email: 'test@example.com' })
  }));
  if (targetPage !== 'dashboard') {
    await page.evaluate((p) => App.navigateTo(p), targetPage);
    await page.waitForTimeout(500);
  }
}

// =============================================================================
// 1. ACCOUNT PAGE TESTS
// =============================================================================

test.describe('Account Page - Rendering & Content', () => {

  test.beforeEach(async ({ page }) => {
    await setupApp(page, 'account');
    await page.waitForFunction(() => {
      const c = document.getElementById('account-container');
      return c && !c.innerHTML.includes('Loading');
    }, { timeout: 10000 });
  });

  test('account page is visible and dashboard is hidden', async ({ page }) => {
    await expect(page.locator('#page-account')).toBeVisible();
    await expect(page.locator('#page-dashboard')).toBeHidden();
  });

  test('profile section shows user name and email', async ({ page }) => {
    const container = page.locator('#account-container');
    await expect(container.locator('text=Test User')).toBeVisible({ timeout: 5000 });
    await expect(container.locator('text=test@example.com')).toBeVisible({ timeout: 5000 });
  });

  test('profile avatar shows first letter of display name', async ({ page }) => {
    // The avatar should show "T" for "Test User"
    const avatar = page.locator('#account-container .rounded-full.bg-oura-subtle');
    await expect(avatar).toBeVisible();
    const text = await avatar.textContent();
    expect(text.trim()).toBe('T');
  });

  test('Oura Ring section shows connection status "Connected"', async ({ page }) => {
    const container = page.locator('#account-container');
    await expect(container.locator('text=Oura Ring')).toBeVisible();
    await expect(container.locator('text=Connected')).toBeVisible();
    await expect(container.locator('text=Syncing sleep data')).toBeVisible();
  });

  test('Settings section has Friends and Sync buttons', async ({ page }) => {
    const container = page.locator('#account-container');
    await expect(container.locator('text=Settings')).toBeVisible();
    await expect(container.locator('text=Friends')).toBeVisible();
    await expect(container.locator('text=Sync Sleep Data')).toBeVisible();
  });

  test('Help section has Report a Bug button', async ({ page }) => {
    const container = page.locator('#account-container');
    await expect(container.locator('text=Help')).toBeVisible();
    await expect(container.locator('text=Report a Bug')).toBeVisible();
  });

  test('Sign Out button exists at bottom', async ({ page }) => {
    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    await expect(signOutBtn).toBeVisible();
  });

  test('bottom nav is visible and Account tab is highlighted', async ({ page }) => {
    const nav = page.locator('.bottom-nav');
    await expect(nav).toBeVisible();

    const accountBtn = page.locator('.nav-btn[data-page="account"]');
    await expect(accountBtn).toHaveClass(/text-oura-accent/);

    // Other tabs should NOT be highlighted
    for (const tab of ['dashboard', 'challenges']) {
      const btn = page.locator(`.nav-btn[data-page="${tab}"]`);
      await expect(btn).not.toHaveClass(/text-oura-accent/);
    }
  });

  test('no console errors on account page', async ({ page }) => {
    const errors = collectErrors(page);
    // Give a moment for any async operations
    await page.waitForTimeout(500);
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

test.describe('Account Page - Touch Targets & Dark Theme', () => {

  test.beforeEach(async ({ page }) => {
    await setupApp(page, 'account');
    await page.waitForFunction(() => {
      const c = document.getElementById('account-container');
      return c && !c.innerHTML.includes('Loading');
    }, { timeout: 10000 });
  });

  test('all buttons have minimum 44px touch targets', async ({ page }) => {
    const buttons = page.locator('#account-container button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const box = await btn.boundingBox();
      if (box) {
        // Check height is at least 44px (standard iOS touch target)
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('Edit Profile button has min-h-[44px] class', async ({ page }) => {
    const editBtn = page.locator('#account-container button', { hasText: 'Edit Profile' });
    const classes = await editBtn.getAttribute('class');
    expect(classes).toContain('min-h-[44px]');
  });

  test('Sign Out button has min-h-[44px] class', async ({ page }) => {
    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    const classes = await signOutBtn.getAttribute('class');
    expect(classes).toContain('min-h-[44px]');
  });

  test('dark theme consistency - no white or light backgrounds', async ({ page }) => {
    // Check page background
    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    // Should be dark (rgb values should be low)
    const rgbMatch = bgColor.match(/\d+/g);
    if (rgbMatch) {
      const [r, g, b] = rgbMatch.map(Number);
      expect(r).toBeLessThan(50);
      expect(g).toBeLessThan(50);
      expect(b).toBeLessThan(50);
    }
  });

  test('account cards use dark theme classes', async ({ page }) => {
    // Check that card backgrounds are dark
    const cards = page.locator('#account-container .bg-oura-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3); // Profile, Oura, Settings, Help sections
  });
});

test.describe('Account Page - Modals & Interactions', () => {

  test.beforeEach(async ({ page }) => {
    await setupApp(page, 'account');
    await page.waitForFunction(() => {
      const c = document.getElementById('account-container');
      return c && !c.innerHTML.includes('Loading');
    }, { timeout: 10000 });
  });

  test('Edit Profile button opens modal with name input', async ({ page }) => {
    const errors = collectErrors(page);
    const editBtn = page.locator('#account-container button', { hasText: 'Edit Profile' });
    await editBtn.click();

    const modal = page.locator('#edit-profile-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal.locator('text=Edit Profile')).toBeVisible();

    const nameInput = modal.locator('#display-name-input');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('Test User');

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Edit Profile modal has Cancel and Save buttons', async ({ page }) => {
    await page.locator('#account-container button', { hasText: 'Edit Profile' }).click();
    const modal = page.locator('#edit-profile-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    await expect(modal.locator('button:has-text("Cancel")')).toBeVisible();
    await expect(modal.locator('button:has-text("Save")')).toBeVisible();
  });

  test('Edit Profile modal Cancel closes it', async ({ page }) => {
    await page.locator('#account-container button', { hasText: 'Edit Profile' }).click();
    const modal = page.locator('#edit-profile-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    await modal.locator('button:has-text("Cancel")').click();
    await expect(modal).toBeHidden({ timeout: 3000 });
  });

  test('Edit Profile modal backdrop click closes it', async ({ page }) => {
    await page.locator('#account-container button', { hasText: 'Edit Profile' }).click();
    const modal = page.locator('#edit-profile-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Click the backdrop (the modal overlay itself, not the inner card)
    await modal.click({ position: { x: 10, y: 10 } });
    await expect(modal).toBeHidden({ timeout: 3000 });
  });

  test('Oura Update button opens token modal', async ({ page }) => {
    const errors = collectErrors(page);
    const ouraBtn = page.locator('#account-container button', { hasText: /Connect|Update|Reconnect/ });
    await expect(ouraBtn).toBeVisible();
    await ouraBtn.click();

    const modal = page.locator('#oura-token-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    const tokenInput = modal.locator('#oura-token-input');
    await expect(tokenInput).toBeVisible();
    await expect(tokenInput).toHaveAttribute('type', 'password');

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Oura token modal has instructions text', async ({ page }) => {
    await page.evaluate(() => Account.showOuraTokenModal());
    const modal = page.locator('#oura-token-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    await expect(modal.locator('text=How to get your token')).toBeVisible();
    await expect(modal.locator('text=cloud.ouraring.com')).toBeVisible();
  });

  test('Oura token modal Cancel closes it', async ({ page }) => {
    await page.evaluate(() => Account.showOuraTokenModal());
    const modal = page.locator('#oura-token-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    await modal.locator('button:has-text("Cancel")').click();
    await expect(modal).toBeHidden({ timeout: 3000 });
  });

  test('Sign Out button triggers confirmation dialog', async ({ page }) => {
    await page.evaluate(() => {
      window._confirmCalled = false;
      window.confirm = () => { window._confirmCalled = true; return false; };
    });

    const signOutBtn = page.locator('#account-container button', { hasText: 'Sign Out' });
    await signOutBtn.click();
    await page.waitForTimeout(500);

    const confirmCalled = await page.evaluate(() => window._confirmCalled);
    expect(confirmCalled).toBe(true);
  });

  test('Friends button in Settings navigates to friends page', async ({ page }) => {
    const friendsBtn = page.locator('#account-container button', { hasText: 'Friends' }).first();
    await expect(friendsBtn).toBeVisible();
    await friendsBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator('#page-friends')).toBeVisible();
    await expect(page.locator('#page-account')).toBeHidden();
  });

  test('Bug Report button opens bug report modal', async ({ page }) => {
    const errors = collectErrors(page);
    await page.evaluate(() => Account.showBugReportModal());

    const modal = page.locator('#bug-report-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    await expect(modal.locator('text=Report a Bug')).toBeVisible();
    await expect(modal.locator('#bug-description')).toBeVisible();
    await expect(modal.locator('button:has-text("Submit")')).toBeVisible();
    await expect(modal.locator('button:has-text("Cancel")')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Bug Report modal Cancel closes it', async ({ page }) => {
    await page.evaluate(() => Account.showBugReportModal());
    const modal = page.locator('#bug-report-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    await modal.locator('button:has-text("Cancel")').click();
    await expect(modal).toBeHidden({ timeout: 3000 });
  });
});

// =============================================================================
// 2. FRIENDS PAGE TESTS
// =============================================================================

test.describe('Friends Page - Rendering & Content', () => {

  test.beforeEach(async ({ page }) => {
    await setupApp(page, 'friends');
    await page.waitForFunction(() => {
      const c = document.getElementById('friends-container');
      return c && !c.innerHTML.includes('Loading');
    }, { timeout: 10000 });
  });

  test('friends page is visible with correct heading', async ({ page }) => {
    await expect(page.locator('#page-friends')).toBeVisible();
    await expect(page.locator('#page-friends h2')).toHaveText('Friends');
  });

  test('invite friend form is present with email input and submit button', async ({ page }) => {
    const form = page.locator('#invite-friend-form');
    await expect(form).toBeVisible();

    const emailInput = page.locator('#friend-email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveAttribute('placeholder', 'friend@email.com');

    const submitBtn = form.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText('Send Invite');
  });

  test('Add Friend card heading is visible', async ({ page }) => {
    await expect(page.locator('#friends-container').locator('text=Add Friend')).toBeVisible();
  });

  test('empty friends list shows "No friends yet" message', async ({ page }) => {
    await expect(page.locator('#friends-container').locator('text=No friends yet')).toBeVisible();
  });

  test('Friends count shows (0) for empty list', async ({ page }) => {
    await expect(page.locator('#friends-container').locator('text=Friends (0)')).toBeVisible();
  });

  test('no console errors on friends page', async ({ page }) => {
    const errors = collectErrors(page);
    await page.waitForTimeout(500);
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

test.describe('Friends Page - Styling & Dark Theme', () => {

  test.beforeEach(async ({ page }) => {
    await setupApp(page, 'friends');
    await page.waitForFunction(() => {
      const c = document.getElementById('friends-container');
      return c && !c.innerHTML.includes('Loading');
    }, { timeout: 10000 });
  });

  test('friends page cards use proper dark theme classes', async ({ page }) => {
    const cards = page.locator('#friends-container .bg-oura-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2); // Add Friend card + Friends list card
  });

  test('email input uses text-base to prevent iOS zoom', async ({ page }) => {
    const emailInput = page.locator('#friend-email');
    const classes = await emailInput.getAttribute('class');
    expect(classes).toContain('text-base');
  });

  test('Send Invite button has proper accent gradient styling', async ({ page }) => {
    const submitBtn = page.locator('#invite-friend-form button[type="submit"]');
    const classes = await submitBtn.getAttribute('class');
    expect(classes).toContain('bg-gradient-to-br');
    expect(classes).toContain('from-oura-accent');
    expect(classes).toContain('to-oura-accent-dark');
    expect(classes).toContain('text-black');
  });

  test('Send Invite button has 44px+ touch target', async ({ page }) => {
    const submitBtn = page.locator('#invite-friend-form button[type="submit"]');
    const classes = await submitBtn.getAttribute('class');
    expect(classes).toContain('min-h-[44px]');
  });
});

test.describe('Friends Page - Invite Form Interaction', () => {

  test.beforeEach(async ({ page }) => {
    await setupApp(page, 'friends');
    await page.waitForFunction(() => {
      const c = document.getElementById('friends-container');
      return c && !c.innerHTML.includes('Loading');
    }, { timeout: 10000 });
  });

  test('typing in email input works', async ({ page }) => {
    const emailInput = page.locator('#friend-email');
    await emailInput.fill('someone@example.com');
    await expect(emailInput).toHaveValue('someone@example.com');
  });

  test('submitting search for non-existent user shows "No user found" message', async ({ page }) => {
    const errors = collectErrors(page);

    // Override searchByEmail to return null
    await page.evaluate(() => {
      Friends.searchByEmail = async () => null;
    });

    await page.fill('#friend-email', 'unknown@example.com');
    await page.click('#invite-friend-form button[type="submit"]');

    await page.waitForFunction(() => {
      const el = document.getElementById('invite-message');
      return el && el.textContent.includes('No user found');
    }, { timeout: 5000 });

    const message = page.locator('#invite-message');
    await expect(message).toContainText('No user found');

    // Verify "Send invite link?" button appears
    const inviteLinkBtn = page.locator('#send-invite-link-btn');
    await expect(inviteLinkBtn).toBeVisible();
    await expect(inviteLinkBtn).toContainText('Send invite link');

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('submitting with valid friend shows "Searching..." then feedback', async ({ page }) => {
    const errors = collectErrors(page);

    // Set up mutation observer to track messages
    await page.evaluate(() => {
      window.__inviteMessages = [];
      const observer = new MutationObserver(() => {
        const el = document.getElementById('invite-message');
        if (el && el.textContent.trim()) {
          window.__inviteMessages.push(el.textContent.trim());
        }
      });
      observer.observe(document.getElementById('friends-container'), {
        childList: true, subtree: true, characterData: true
      });
    });

    // Mock searchByEmail to return a friend
    await page.evaluate(() => {
      Friends.searchByEmail = async () => ({ id: 'friend-1', email: 'friend@example.com', display_name: 'Friend User' });
      Friends.sendRequest = async () => ({ id: 'fs-1' });
    });

    await page.fill('#friend-email', 'friend@example.com');
    await page.click('#invite-friend-form button[type="submit"]');

    await page.waitForFunction(() => {
      return window.__inviteMessages && window.__inviteMessages.length >= 1;
    }, { timeout: 10000 });

    const messages = await page.evaluate(() => window.__inviteMessages);
    const allText = messages.join(' ');
    expect(allText).toMatch(/Searching|Friend request sent|request/i);

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

test.describe('Friends Page - With Friends Data', () => {

  test('renders friend list when friends exist', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Override getFriends to return a friend
    await page.evaluate(() => {
      Friends.getFriends = async () => [
        { friendshipId: 'fs-1', id: 'friend-1', email: 'alice@example.com', displayName: 'Alice', since: new Date().toISOString() }
      ];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForFunction(() => {
      const c = document.getElementById('friends-container');
      return c && !c.innerHTML.includes('Loading') && c.innerHTML.includes('Alice');
    }, { timeout: 10000 });

    const container = page.locator('#friends-container');
    await expect(container.locator('text=Friends (1)')).toBeVisible();
    await expect(container.getByText('Alice', { exact: true })).toBeVisible();
    await expect(container.locator('text=alice@example.com')).toBeVisible();

    // Remove button should be visible
    const removeBtn = container.locator('button', { hasText: 'Remove' });
    await expect(removeBtn).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('renders pending requests section when requests exist', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Override to return pending requests
    await page.evaluate(() => {
      Friends.getPendingRequests = async () => [
        { friendshipId: 'fs-2', id: 'requester-1', email: 'bob@example.com', displayName: 'Bob', requestedAt: new Date().toISOString() }
      ];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForFunction(() => {
      const c = document.getElementById('friends-container');
      return c && !c.innerHTML.includes('Loading') && c.innerHTML.includes('Bob');
    }, { timeout: 10000 });

    const container = page.locator('#friends-container');
    await expect(container.locator('text=Friend Requests (1)')).toBeVisible();
    await expect(container.getByText('Bob', { exact: true })).toBeVisible();

    // Accept and Decline buttons should be visible
    await expect(container.locator('button', { hasText: 'Accept' })).toBeVisible();
    await expect(container.locator('button', { hasText: 'Decline' })).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// =============================================================================
// 3. NAVIGATION TESTS
// =============================================================================

test.describe('Navigation - Sequential Tab Cycling', () => {

  test('Home tab shows dashboard with correct highlighting', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    await page.click('.nav-btn[data-page="dashboard"]');
    await page.waitForTimeout(300);

    await expect(page.locator('#page-dashboard')).toBeVisible();
    await expect(page.locator('.nav-btn[data-page="dashboard"]')).toHaveClass(/text-oura-accent/);

    // All other pages hidden
    for (const other of ['challenges', 'account']) {
      await expect(page.locator(`#page-${other}`)).toBeHidden();
      await expect(page.locator(`.nav-btn[data-page="${other}"]`)).not.toHaveClass(/text-oura-accent/);
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Challenges tab shows challenges with correct highlighting', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    await page.click('.nav-btn[data-page="challenges"]');
    await page.waitForTimeout(300);

    await expect(page.locator('#page-challenges')).toBeVisible();
    await expect(page.locator('.nav-btn[data-page="challenges"]')).toHaveClass(/text-oura-accent/);

    for (const other of ['dashboard', 'account']) {
      await expect(page.locator(`#page-${other}`)).toBeHidden();
      await expect(page.locator(`.nav-btn[data-page="${other}"]`)).not.toHaveClass(/text-oura-accent/);
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Account tab shows account with correct highlighting', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    await page.click('.nav-btn[data-page="account"]');
    await page.waitForTimeout(300);

    await expect(page.locator('#page-account')).toBeVisible();
    await expect(page.locator('.nav-btn[data-page="account"]')).toHaveClass(/text-oura-accent/);

    for (const other of ['dashboard', 'challenges']) {
      await expect(page.locator(`#page-${other}`)).toBeHidden();
      await expect(page.locator(`.nav-btn[data-page="${other}"]`)).not.toHaveClass(/text-oura-accent/);
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

test.describe('Navigation - Full Cycle', () => {

  test('cycling Home -> Challenges -> Account works correctly', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    const tabs = ['dashboard', 'challenges', 'account'];

    for (const tab of tabs) {
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(300);

      // Current page visible
      await expect(page.locator(`#page-${tab}`)).toBeVisible();

      // Active tab highlighted
      await expect(page.locator(`.nav-btn[data-page="${tab}"]`)).toHaveClass(/text-oura-accent/);

      // All other pages hidden
      for (const other of tabs) {
        if (other !== tab) {
          await expect(page.locator(`#page-${other}`)).toBeHidden();
          await expect(page.locator(`.nav-btn[data-page="${other}"]`)).not.toHaveClass(/text-oura-accent/);
        }
      }
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('reverse cycle Account -> Challenges -> Home works', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    const tabs = ['account', 'challenges', 'dashboard'];

    for (const tab of tabs) {
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(300);

      await expect(page.locator(`#page-${tab}`)).toBeVisible();
      await expect(page.locator(`.nav-btn[data-page="${tab}"]`)).toHaveClass(/text-oura-accent/);
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('no white flash during page transitions (body stays dark)', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    const tabs = ['dashboard', 'challenges', 'account'];

    for (const tab of tabs) {
      await page.click(`.nav-btn[data-page="${tab}"]`);

      // Check body background right after navigation
      const bgColor = await page.evaluate(() => {
        return getComputedStyle(document.body).backgroundColor;
      });

      const rgbMatch = bgColor.match(/\d+/g);
      if (rgbMatch) {
        const [r, g, b] = rgbMatch.map(Number);
        // Body should remain dark during transitions
        expect(r).toBeLessThan(50);
        expect(g).toBeLessThan(50);
        expect(b).toBeLessThan(50);
      }

      await page.waitForTimeout(200);
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('bottom nav remains visible throughout all transitions', async ({ page }) => {
    await setupApp(page);

    const tabs = ['dashboard', 'challenges', 'account'];

    for (const tab of tabs) {
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(200);

      const nav = page.locator('.bottom-nav');
      await expect(nav).toBeVisible();
    }
  });
});

test.describe('Navigation - Error Accumulation', () => {

  test('no console errors accumulate during full navigation cycle with mocked Supabase', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    const tabs = ['dashboard', 'challenges', 'account'];

    // Full forward cycle
    for (const tab of tabs) {
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(500);
    }

    // Visit friends page programmatically
    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(500);

    // Return to dashboard
    await page.click('.nav-btn[data-page="dashboard"]');
    await page.waitForTimeout(500);

    // Another full cycle
    for (const tab of tabs) {
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(300);
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('App.currentPage tracks correctly through navigation', async ({ page }) => {
    await setupApp(page);

    const tabs = ['dashboard', 'challenges', 'account'];

    for (const tab of tabs) {
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(200);

      const current = await page.evaluate(() => App.currentPage);
      expect(current).toBe(tab);
    }
  });

  test('rapid tab switching does not crash or leave stale state', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page);

    const tabs = ['dashboard', 'challenges', 'account'];

    // 20 rapid clicks
    for (let i = 0; i < 20; i++) {
      const tab = tabs[i % tabs.length];
      await page.click(`.nav-btn[data-page="${tab}"]`);
      await page.waitForTimeout(50);
    }

    // Last click: i=19, tabs[19%3] = tabs[1] = 'challenges'
    const lastTab = tabs[19 % tabs.length];
    await page.waitForTimeout(500);

    await expect(page.locator(`#page-${lastTab}`)).toBeVisible();
    await expect(page.locator(`.nav-btn[data-page="${lastTab}"]`)).toHaveClass(/text-oura-accent/);

    // Verify only one page is visible
    for (const tab of tabs) {
      if (tab !== lastTab) {
        await expect(page.locator(`#page-${tab}`)).toBeHidden();
      }
    }

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

test.describe('Navigation - Account to Friends and Back', () => {

  test('clicking Friends in account settings navigates to friends, then back to account via nav', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'account');
    await page.waitForFunction(() => {
      const c = document.getElementById('account-container');
      return c && !c.innerHTML.includes('Loading');
    }, { timeout: 10000 });

    // Click Friends button in Settings section
    const friendsBtn = page.locator('#account-container button', { hasText: 'Friends' }).first();
    await friendsBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator('#page-friends')).toBeVisible();
    await expect(page.locator('#page-account')).toBeHidden();

    // Navigate back to account via bottom nav
    await page.click('.nav-btn[data-page="account"]');
    await page.waitForTimeout(500);

    await expect(page.locator('#page-account')).toBeVisible();
    await expect(page.locator('#page-friends')).toBeHidden();
    await expect(page.locator('.nav-btn[data-page="account"]')).toHaveClass(/text-oura-accent/);

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});
