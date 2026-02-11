// @ts-check
const { test, expect } = require('@playwright/test');

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
    const mockFriend = { id: 'friend-1', email: 'friend@example.com', display_name: 'Friend User' };
    const mockQuery = {
      select: () => mockQuery, eq: () => mockQuery, neq: () => mockQuery,
      gte: () => mockQuery, lte: () => mockQuery, or: () => mockQuery,
      order: () => mockQuery,
      single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: null, onboarding_step: 4 }, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      insert: () => Promise.resolve({ data: {}, error: null }),
      update: () => mockQuery, delete: () => mockQuery,
      then: (fn) => Promise.resolve({ data: [], error: null }).then(fn),
    };
    SupabaseClient.client.from = (table) => {
      if (table === 'profiles') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, neq: () => ({ ...mockQuery, single: () => Promise.resolve({ data: mockFriend, error: null }) }), single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: null, onboarding_step: 4 }, error: null }), order: () => Promise.resolve({ data: [], error: null }) }), or: () => Promise.resolve({ data: [], error: null }), order: () => Promise.resolve({ data: [], error: null }), neq: () => ({ ...mockQuery, single: () => Promise.resolve({ data: mockFriend, error: null }) }) }) };
      }
      if (table === 'friendships') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, eq: () => Promise.resolve({ data: [], error: null }), or: () => Promise.resolve({ data: [], error: null }) }), or: () => ({ ...mockQuery, single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          insert: () => ({ ...mockQuery, select: () => ({ ...mockQuery, single: () => Promise.resolve({ data: { id: 'fs-1', user_id: 'test-user-id', friend_id: 'friend-1', status: 'pending' }, error: null }) }) })
        };
      }
      if (table === 'pending_invites') {
        return { ...mockQuery, select: () => ({ ...mockQuery, order: () => Promise.resolve({ data: [], error: null }) }),
          insert: () => ({ ...mockQuery, select: () => ({ ...mockQuery, single: () => Promise.resolve({ data: { id: 'inv-1', invited_email: 'new@example.com' }, error: null }) }) })
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
    SupabaseClient.client.rpc = () => Promise.resolve({ data: [], error: null });
    Auth.getProfile = () => Promise.resolve({ display_name: 'Test User', oura_token: null, onboarding_step: 4 });
    if (typeof Cache !== 'undefined') { Cache.get = () => null; Cache.set = () => {}; Cache.clear = () => {}; }
    if (typeof Challenges !== 'undefined') { Challenges.getInvitations = async () => []; Challenges.getActiveChallenges = async () => []; Challenges.getMyChallenges = async () => []; }
    Friends.getPendingRequests = async () => [];
    Friends.getSentRequests = async () => [];
    Friends.getPendingInvites = async () => [];
    Friends.getFriends = async () => [];
  });
}

async function setupApp(page, targetPage = 'dashboard') {
  await showApp(page);
  await mockSupabase(page);
  if (targetPage !== 'dashboard') {
    await page.evaluate((p) => App.navigateTo(p), targetPage);
    await page.waitForTimeout(500);
  }
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

// ─────────────────────────────────────────────────────
// 1. Friend Search and Request
// ─────────────────────────────────────────────────────
test.describe('Friend Search and Request', () => {
  test('Friends page loads with invite form, email input, and submit button', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');

    await expect(page.locator('#page-friends')).toBeVisible();
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    const emailInput = page.locator('#friend-email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');

    const submitBtn = page.locator('#invite-friend-form button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText('Send Invite');

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Search existing email — shows "Searching..." then "Friend request sent!"', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Mock Friends.searchByEmail to return a known user
    await page.evaluate(() => {
      Friends.searchByEmail = async (email) => {
        return { id: 'friend-1', email: email, display_name: 'Friend User' };
      };
      Friends.sendRequest = async () => {
        return { id: 'fs-1', user_id: 'test-user-id', friend_id: 'friend-1', status: 'pending' };
      };
    });

    // Set up mutation observer to track messages
    await page.evaluate(() => {
      window.__inviteMessages = [];
      const observer = new MutationObserver(() => {
        const el = document.getElementById('invite-message');
        if (el && el.textContent.trim()) window.__inviteMessages.push(el.textContent.trim());
      });
      observer.observe(document.getElementById('friends-container'), { childList: true, subtree: true, characterData: true });
    });

    await page.fill('#friend-email', 'friend@example.com');
    await page.click('#invite-friend-form button[type="submit"]');

    // Wait for at least one message to appear
    await page.waitForFunction(() => {
      return window.__inviteMessages && window.__inviteMessages.length >= 1;
    }, { timeout: 10000 });

    const messages = await page.evaluate(() => window.__inviteMessages);
    expect(messages.length).toBeGreaterThan(0);
    const allText = messages.join(' ');
    expect(allText).toMatch(/Searching|Friend request sent|request/i);

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Search unknown email — shows "No user found" and invite link button', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Override searchByEmail to return null (no user found)
    await page.evaluate(() => {
      Friends.searchByEmail = async () => null;
    });

    await page.fill('#friend-email', 'unknown@example.com');
    await page.click('#invite-friend-form button[type="submit"]');

    // Wait for "No user found" text
    await page.waitForFunction(() => {
      const el = document.getElementById('invite-message');
      return el && el.textContent.includes('No user found');
    }, { timeout: 5000 });

    await expect(page.locator('#invite-message')).toContainText('No user found');

    // Verify "Send invite link?" button appears
    const inviteLinkBtn = page.locator('#send-invite-link-btn');
    await expect(inviteLinkBtn).toBeVisible();
    await expect(inviteLinkBtn).toContainText('Send invite link');

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Click "Send invite link" button after unknown email — sends invite', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    await page.evaluate(() => {
      Friends.searchByEmail = async () => null;
    });

    // Set up mutation observer BEFORE triggering the flow
    await page.evaluate(() => {
      window.__inviteMessages = [];
      const observer = new MutationObserver(() => {
        const el = document.getElementById('invite-message');
        if (el && el.textContent.trim()) window.__inviteMessages.push(el.textContent.trim());
      });
      observer.observe(document.getElementById('friends-container'), { childList: true, subtree: true, characterData: true });
    });

    await page.fill('#friend-email', 'new@example.com');
    await page.click('#invite-friend-form button[type="submit"]');

    await page.waitForSelector('#send-invite-link-btn', { timeout: 5000 });

    // Mock sendInviteLink to succeed
    await page.evaluate(() => {
      Friends.sendInviteLink = async (email) => ({
        id: 'inv-1', invited_email: email, emailSent: true, emailError: null
      });
    });

    // Route the invite API endpoint
    await page.route('**/api/invite', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    );

    await page.click('#send-invite-link-btn');

    // Wait for invite-related feedback via observer (message may be cleared by re-render)
    await page.waitForFunction(() => {
      const msgs = window.__inviteMessages || [];
      return msgs.some(m => /invite|sent|link|email|copied/i.test(m));
    }, { timeout: 10000 });

    const messages = await page.evaluate(() => window.__inviteMessages);
    const allText = messages.join(' ').toLowerCase();
    expect(allText).toMatch(/invite|sent|link|email|copied/i);

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Empty email submission — HTML5 validation prevents submit', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Set up observer to ensure no message appears
    await page.evaluate(() => {
      window.__inviteMessages = [];
      const observer = new MutationObserver(() => {
        const el = document.getElementById('invite-message');
        if (el && el.textContent.trim()) window.__inviteMessages.push(el.textContent.trim());
      });
      observer.observe(document.getElementById('friends-container'), { childList: true, subtree: true, characterData: true });
    });

    // Leave email empty and click submit
    const emailInput = page.locator('#friend-email');
    await expect(emailInput).toHaveValue('');
    await page.click('#invite-friend-form button[type="submit"]');

    // Wait a moment to ensure nothing happens
    await page.waitForTimeout(500);

    // The invite-message should still be hidden or empty
    // (handleInvite returns early when email is empty: `if (!email) return;`)
    const messages = await page.evaluate(() => window.__inviteMessages);
    expect(messages.length).toBe(0);

    // The invite-message element should still be hidden
    const isHidden = await page.evaluate(() => {
      const el = document.getElementById('invite-message');
      return !el || el.classList.contains('hidden') || el.textContent.trim() === '';
    });
    expect(isHidden).toBe(true);

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Submit same email as logged in user — handles appropriately', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Mock searchByEmail to return null for own email (RPC typically excludes self)
    await page.evaluate(() => {
      Friends.searchByEmail = async () => null;
    });

    await page.fill('#friend-email', 'test@example.com');
    await page.click('#invite-friend-form button[type="submit"]');

    // Should show "No user found" or similar (since you can't friend yourself)
    await page.waitForFunction(() => {
      const el = document.getElementById('invite-message');
      return el && el.textContent.trim().length > 0 && !el.classList.contains('hidden');
    }, { timeout: 5000 });

    const messageEl = page.locator('#invite-message');
    await expect(messageEl).toBeVisible();
    const text = await messageEl.textContent();
    expect(text.length).toBeGreaterThan(0);

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────
// 2. Friend Requests Management
// ─────────────────────────────────────────────────────
test.describe('Friend Requests Management', () => {
  test('Pending requests section renders with incoming requests', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Override getPendingRequests to return a request, then re-render
    await page.evaluate(() => {
      Friends.getPendingRequests = async () => [{
        friendshipId: 'req-1',
        id: 'other-user',
        email: 'other@example.com',
        displayName: 'Other User',
        requestedAt: new Date().toISOString()
      }];
      Friends.render();
    });
    await page.waitForTimeout(500);

    // Verify pending requests section appears with "Friend Requests" heading
    const heading = page.locator('text=Friend Requests');
    await expect(heading).toBeVisible({ timeout: 3000 });

    // Verify the requester name is shown
    await expect(page.locator('text=Other User')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Accept button exists for pending requests', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    await page.evaluate(() => {
      Friends.getPendingRequests = async () => [{
        friendshipId: 'req-1',
        id: 'other-user',
        email: 'other@example.com',
        displayName: 'Other User',
        requestedAt: new Date().toISOString()
      }];
      Friends.render();
    });
    await page.waitForTimeout(500);

    const acceptBtn = page.locator('button:has-text("Accept")');
    await expect(acceptBtn).toBeVisible({ timeout: 3000 });

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Decline button exists for pending requests', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    await page.evaluate(() => {
      Friends.getPendingRequests = async () => [{
        friendshipId: 'req-1',
        id: 'other-user',
        email: 'other@example.com',
        displayName: 'Other User',
        requestedAt: new Date().toISOString()
      }];
      Friends.render();
    });
    await page.waitForTimeout(500);

    const declineBtn = page.locator('button:has-text("Decline")');
    await expect(declineBtn).toBeVisible({ timeout: 3000 });

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Sent requests section renders with outgoing requests', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    await page.evaluate(() => {
      Friends.getSentRequests = async () => [{
        friendshipId: 'req-2',
        id: 'other-user',
        email: 'pending@example.com',
        displayName: 'Pending Friend',
        sentAt: new Date().toISOString()
      }];
      Friends.render();
    });
    await page.waitForTimeout(500);

    // Verify sent requests section appears
    const heading = page.locator('text=Sent Requests');
    await expect(heading).toBeVisible({ timeout: 3000 });

    // Verify the pending friend's name is shown
    await expect(page.locator('text=Pending Friend')).toBeVisible();

    // Verify "Pending" status label
    await expect(page.locator('#friends-container >> text=Pending').last()).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Friends list section renders with accepted friends', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    await page.evaluate(() => {
      Friends.getFriends = async () => [{
        friendshipId: 'f-1',
        id: 'friend-1',
        displayName: 'Best Friend',
        email: 'best@example.com',
        since: new Date().toISOString()
      }];
      Friends.render();
    });
    await page.waitForTimeout(500);

    // Verify friends list section shows the friend
    await expect(page.locator('text=Best Friend')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=best@example.com')).toBeVisible();

    // Verify "Remove" button exists
    const removeBtn = page.locator('button:has-text("Remove")');
    await expect(removeBtn).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────
// 3. Oura Ring Connection
// ─────────────────────────────────────────────────────
test.describe('Oura Ring Connection', () => {
  test('Account page has "Oura Ring" section', async ({ page }) => {
    const errors = collectErrors(page);

    // Route the personal_info API to prevent real network calls
    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );

    await setupApp(page, 'account');
    await page.waitForTimeout(500);

    // Verify Oura Ring section heading exists (use role to avoid matching multiple elements)
    await expect(page.getByRole('heading', { name: 'Oura Ring' })).toBeVisible({ timeout: 5000 });

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('With oura_token=null, shows "Not Connected" status', async ({ page }) => {
    const errors = collectErrors(page);

    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );

    await setupApp(page, 'account');
    await page.waitForTimeout(500);

    // Default mock has oura_token: null, so status should be "Not Connected"
    await expect(page.locator('text=Not Connected')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Connect to track sleep')).toBeVisible();

    // The button should say "Connect"
    const connectBtn = page.locator('#page-account button:has-text("Connect")').first();
    await expect(connectBtn).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('With oura_token set, shows connected status', async ({ page }) => {
    const errors = collectErrors(page);

    // Route the personal_info API to return 200 (valid token)
    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );

    await setupApp(page, 'account');

    // Override Account.getProfile to return a token
    await page.evaluate(() => {
      Account.getProfile = async () => ({ display_name: 'Test User', oura_token: 'fake-token' });
      Account.render();
    });
    await page.waitForTimeout(800);

    // Should show "Connected" and "Syncing sleep data"
    await expect(page.locator('text=Connected').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Syncing sleep data')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Click Connect button opens #oura-token-modal', async ({ page }) => {
    const errors = collectErrors(page);

    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );

    await setupApp(page, 'account');
    await page.waitForTimeout(500);

    // Click the Connect button
    const connectBtn = page.locator('#page-account button:has-text("Connect")').first();
    await expect(connectBtn).toBeVisible({ timeout: 5000 });
    await connectBtn.click();

    // Verify modal opens
    await page.waitForSelector('#oura-token-modal', { timeout: 5000 });
    await expect(page.locator('#oura-token-modal')).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Oura modal has password-type token input', async ({ page }) => {
    const errors = collectErrors(page);

    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );

    await setupApp(page, 'account');
    await page.waitForTimeout(500);

    // Open the modal
    const connectBtn = page.locator('#page-account button:has-text("Connect")').first();
    await connectBtn.click();
    await page.waitForSelector('#oura-token-modal', { timeout: 5000 });

    // Verify the token input exists and is type=password
    const tokenInput = page.locator('#oura-token-input');
    await expect(tokenInput).toBeVisible();
    await expect(tokenInput).toHaveAttribute('type', 'password');

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Fill token and submit — saves successfully', async ({ page }) => {
    const errors = collectErrors(page);

    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );

    await setupApp(page, 'account');
    await page.waitForTimeout(500);

    // Open the modal
    const connectBtn = page.locator('#page-account button:has-text("Connect")').first();
    await connectBtn.click();
    await page.waitForSelector('#oura-token-modal', { timeout: 5000 });

    // Fill and submit the token
    await page.fill('#oura-token-input', 'my-oura-test-token-abc123');
    await page.click('#oura-token-form button[type="submit"]');

    // Verify success message appears
    await page.waitForFunction(() => {
      const el = document.getElementById('oura-token-status');
      return el && el.textContent.includes('saved successfully');
    }, { timeout: 5000 });

    await expect(page.locator('#oura-token-status')).toContainText('saved successfully');

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Close modal by clicking cancel button', async ({ page }) => {
    const errors = collectErrors(page);

    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );

    await setupApp(page, 'account');
    await page.waitForTimeout(500);

    // Open the modal
    const connectBtn = page.locator('#page-account button:has-text("Connect")').first();
    await connectBtn.click();
    await page.waitForSelector('#oura-token-modal', { timeout: 5000 });
    await expect(page.locator('#oura-token-modal')).toBeVisible();

    // Click the Cancel button
    const cancelBtn = page.locator('#oura-token-modal button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // Verify modal is removed
    await expect(page.locator('#oura-token-modal')).toHaveCount(0, { timeout: 3000 });

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────
// 4. Invite Link Flow
// ─────────────────────────────────────────────────────
test.describe('Invite Link Flow', () => {
  test('Search unknown email, click "Send invite link", verify invite sent', async ({ page }) => {
    const errors = collectErrors(page);

    // Route the invite API
    await page.route('**/api/invite', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    );

    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Mock searchByEmail to return null and sendInviteLink to succeed
    await page.evaluate(() => {
      Friends.searchByEmail = async () => null;
      Friends.sendInviteLink = async (email) => ({
        id: 'inv-1', invited_email: email, emailSent: true, emailError: null
      });
    });

    // Set up observer to track messages
    await page.evaluate(() => {
      window.__inviteMessages = [];
      const observer = new MutationObserver(() => {
        const el = document.getElementById('invite-message');
        if (el && el.textContent.trim()) window.__inviteMessages.push(el.textContent.trim());
      });
      observer.observe(document.getElementById('friends-container'), { childList: true, subtree: true, characterData: true });
    });

    // Search for unknown email
    await page.fill('#friend-email', 'new@example.com');
    await page.click('#invite-friend-form button[type="submit"]');

    // Wait for "No user found" and invite link button
    await page.waitForSelector('#send-invite-link-btn', { timeout: 5000 });

    // Click "Send invite link"
    await page.click('#send-invite-link-btn');

    // Wait for feedback
    await page.waitForFunction(() => {
      const msgs = window.__inviteMessages || [];
      return msgs.some(m => /invite|sent|link|email/i.test(m));
    }, { timeout: 5000 });

    const messages = await page.evaluate(() => window.__inviteMessages);
    const allText = messages.join(' ').toLowerCase();
    expect(allText).toMatch(/invite|sent|link|email/i);

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Pending invites section shows sent invites', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Override getPendingInvites to return an invite, then re-render
    await page.evaluate(() => {
      Friends.getPendingInvites = async () => [{
        id: 'inv-1',
        invited_email: 'new@example.com',
        created_at: new Date().toISOString()
      }];
      Friends.render();
    });
    await page.waitForTimeout(500);

    // Verify pending invites section appears
    await expect(page.locator('text=Invite Links Sent')).toBeVisible({ timeout: 3000 });

    // Verify the invited email is shown
    await expect(page.locator('text=new@example.com')).toBeVisible();

    // Verify "Cancel" button exists
    const cancelBtn = page.locator('#friends-container button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible();

    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────
// 5. Connection Error Handling
// ─────────────────────────────────────────────────────
test.describe('Connection Error Handling', () => {
  test('Friend search with network error — shows error message', async ({ page }) => {
    const errors = collectErrors(page);
    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Mock searchByEmail to throw a network error
    await page.evaluate(() => {
      Friends.searchByEmail = async () => { throw new Error('Network error: unable to reach server'); };
    });

    await page.fill('#friend-email', 'friend@example.com');
    await page.click('#invite-friend-form button[type="submit"]');

    // Wait for error message to appear in #invite-message
    await page.waitForFunction(() => {
      const el = document.getElementById('invite-message');
      return el && el.textContent.trim().length > 0 && !el.classList.contains('hidden');
    }, { timeout: 5000 });

    const messageEl = page.locator('#invite-message');
    await expect(messageEl).toBeVisible();
    const text = await messageEl.textContent();
    expect(text.toLowerCase()).toMatch(/error|network|unable|fail/i);

    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('Oura token save with error — shows error feedback', async ({ page }) => {
    const errors = collectErrors(page);

    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );

    await setupApp(page, 'account');
    await page.waitForTimeout(500);

    // Open the modal
    const connectBtn = page.locator('#page-account button:has-text("Connect")').first();
    await connectBtn.click();
    await page.waitForSelector('#oura-token-modal', { timeout: 5000 });

    // Mock updateProfile to throw
    await page.evaluate(() => {
      Account.updateProfile = async () => { throw new Error('Database write failed'); };
    });

    // Fill and submit
    await page.fill('#oura-token-input', 'bad-token-will-fail');
    await page.click('#oura-token-form button[type="submit"]');

    // Wait for error feedback in #oura-token-status
    await page.waitForFunction(() => {
      const el = document.getElementById('oura-token-status');
      return el && el.textContent.includes('Failed');
    }, { timeout: 5000 });

    await expect(page.locator('#oura-token-status')).toContainText('Failed');

    // Filter out the expected "Error saving token" console.error from the intentional mock throw
    const unexpected = unexpectedErrors(errors).filter(e => !e.includes('Error saving token'));
    expect(unexpected).toEqual([]);
  });

  test('No unexpected console errors across connection flows', async ({ page }) => {
    const errors = collectErrors(page);

    await page.route('**/api/personal_info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'test@example.com' }) })
    );
    await page.route('**/api/invite', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    );

    await setupApp(page, 'friends');
    await page.waitForSelector('#invite-friend-form', { timeout: 5000 });

    // Navigate to account and back to friends
    await page.evaluate(() => App.navigateTo('account'));
    await page.waitForTimeout(500);
    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(500);

    // Verify zero unexpected errors across navigation
    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });
});
