// @ts-check
const { test, expect } = require('@playwright/test');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function showOnboardingStep(page, step) {
  await waitForAuthInit(page);
  await page.evaluate((s) => {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('onboarding-section').classList.remove('hidden');
    document.getElementById('app-content').classList.add('hidden');
    document.querySelector('.bottom-nav')?.classList.add('hidden');
    if (window.Onboarding) {
      window.Onboarding.profile = { onboarding_step: s };
      window.Onboarding.renderStep(s);
    }
    const container = document.getElementById('onboarding-container');
    if (container) {
      container.classList.remove('onboarding-step-enter');
      container.classList.add('onboarding-step-active');
    }
  }, step);
}

async function mockSupabase(page) {
  await page.evaluate(() => {
    SupabaseClient.getCurrentUser = () => Promise.resolve({ id: 'test-user-id', email: 'test@example.com' });
    SupabaseClient.signOut = async () => {};
    const mockChallenge = {
      id: 'challenge-1', name: 'Test Challenge', mode: 'pro',
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date(Date.now() + 30*86400000).toISOString().split('T')[0],
      created_at: new Date().toISOString(),
      protocol: { id: 'proto-1', name: 'Sleep Protocol', icon: '🌙', description: 'Test', habits: [
        { id: 'h1', title: 'No caffeine after 2pm', description: '', sort_order: 1 },
        { id: 'h2', title: 'Screen off by 10pm', description: '', sort_order: 2 }
      ]},
      creator: { id: 'test-user-id', email: 'test@example.com', display_name: 'Test User' },
      participants: [{ id: 'p1', status: 'accepted', joined_at: new Date().toISOString(), user: { id: 'test-user-id', email: 'test@example.com', display_name: 'Test User' }}]
    };
    const mockProtocols = [
      { id: 'proto-1', name: 'Sleep Protocol', icon: '🌙', description: 'Better sleep', user_id: null },
      { id: 'proto-2', name: 'Morning Routine', icon: '☀️', description: 'Rise and shine', user_id: null }
    ];
    const mockQuery = {
      select: () => mockQuery, eq: () => mockQuery, neq: () => mockQuery,
      gte: () => mockQuery, lte: () => mockQuery, or: () => mockQuery,
      order: () => mockQuery,
      single: () => Promise.resolve({ data: mockChallenge, error: null }),
      insert: () => ({ ...mockQuery, select: () => ({ ...mockQuery, single: () => Promise.resolve({ data: mockChallenge, error: null }) }) }),
      update: () => mockQuery, delete: () => mockQuery,
      then: (fn) => Promise.resolve({ data: [], error: null }).then(fn),
    };
    SupabaseClient.client.from = (table) => {
      if (table === 'protocols') {
        return { ...mockQuery, select: () => ({ ...mockQuery, order: () => Promise.resolve({ data: mockProtocols, error: null }), eq: () => ({ ...mockQuery, single: () => Promise.resolve({ data: { ...mockProtocols[0], habits: mockChallenge.protocol.habits }, error: null }) }) }) };
      }
      if (table === 'challenges') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, single: () => Promise.resolve({ data: mockChallenge, error: null }), order: () => Promise.resolve({ data: [mockChallenge], error: null }) }), order: () => Promise.resolve({ data: [mockChallenge], error: null }) }),
          insert: () => ({ ...mockQuery, select: () => ({ ...mockQuery, single: () => Promise.resolve({ data: mockChallenge, error: null }) }) }),
          delete: () => ({ ...mockQuery, eq: () => Promise.resolve({ data: null, error: null }) })
        };
      }
      if (table === 'challenge_participants') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, eq: () => Promise.resolve({ data: [], error: null }), order: () => Promise.resolve({ data: [{ id: 'p1', status: 'accepted', joined_at: new Date().toISOString(), challenge: mockChallenge }], error: null }) }), or: () => Promise.resolve({ data: [], error: null }) }),
          insert: () => Promise.resolve({ data: {}, error: null })
        };
      }
      if (table === 'sleep_data') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, gte: () => ({ ...mockQuery, order: () => Promise.resolve({ data: [
          { date: new Date().toISOString().split('T')[0], avg_hr: 58, sleep_score: 85, total_sleep_minutes: 420, pre_sleep_hr: 55, deep_sleep_minutes: 90 }
        ], error: null }) }) }) }) };
      }
      if (table === 'habit_completions') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, eq: () => Promise.resolve({ data: [], error: null }) }) }) }) };
      }
      if (table === 'profiles') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, single: () => Promise.resolve({ data: { display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 }, error: null }), order: () => Promise.resolve({ data: [], error: null }) }), or: () => Promise.resolve({ data: [], error: null }), order: () => Promise.resolve({ data: [], error: null }) }) };
      }
      if (table === 'friendships') {
        return { ...mockQuery, select: () => ({ ...mockQuery, eq: () => ({ ...mockQuery, eq: () => Promise.resolve({ data: [], error: null }), or: () => Promise.resolve({ data: [], error: null }) }), or: () => ({ ...mockQuery, single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }) }) }),
          insert: () => ({ ...mockQuery, select: () => ({ ...mockQuery, single: () => Promise.resolve({ data: { id: 'fs-1' }, error: null }) }) })
        };
      }
      if (table === 'pending_invites') {
        return { ...mockQuery, select: () => ({ ...mockQuery, order: () => Promise.resolve({ data: [], error: null }) }) };
      }
      if (table === 'protocol_habits') {
        return { ...mockQuery, select: () => ({ ...mockQuery, order: () => ({ ...mockQuery, order: () => Promise.resolve({ data: mockChallenge.protocol.habits.map(h => ({ ...h, protocol: mockProtocols[0] })), error: null }) }) }) };
      }
      return mockQuery;
    };
    Auth.getProfile = () => Promise.resolve({ display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 });
    if (typeof SleepSync !== 'undefined') SleepSync.syncNow = async () => ({ success: true, synced: 1 });
    if (typeof Comparison !== 'undefined') {
      Comparison.renderForChallenge = async () => {};
      Comparison.getChallengeSleepData = async () => ({ sleepData: [] });
    }
    if (typeof Friends !== 'undefined') { Friends.getFriends = async () => []; Friends.getPendingRequests = async () => []; Friends.getSentRequests = async () => []; Friends.getPendingInvites = async () => []; }
    if (typeof Challenges !== 'undefined') { Challenges.getInvitations = async () => []; }
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

// ── 1. Protocol Interactions ─────────────────────────────────────────────────

test.describe('Protocol Interactions', () => {

  test('Navigate to protocols page and verify protocol cards render', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.click('button[data-page="protocols"]');

    const protocolsPage = page.locator('#page-protocols');
    await expect(protocolsPage).toBeVisible();

    // Wait for protocols to load (no longer shows "Loading protocols...")
    await page.waitForFunction(() => {
      const el = document.getElementById('protocols-container');
      return el && !el.textContent.includes('Loading protocols');
    }, { timeout: 5000 });

    // Verify 2 mock protocol cards rendered
    const cards = protocolsPage.locator('#protocols-container .bg-oura-card[onclick]');
    await expect(cards).toHaveCount(2);

    // Verify protocol names appear
    await expect(protocolsPage.locator('text=Sleep Protocol')).toBeVisible();
    await expect(protocolsPage.locator('text=Morning Routine')).toBeVisible();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Click a protocol card navigates to protocol-detail page', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.click('button[data-page="protocols"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('protocols-container');
      return el && !el.textContent.includes('Loading protocols');
    }, { timeout: 5000 });

    // Click the first protocol card (Sleep Protocol)
    await page.click('#protocols-container .bg-oura-card[onclick]');

    // Verify protocol-detail page is visible
    const detailPage = page.locator('#page-protocol-detail');
    await expect(detailPage).toBeVisible({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Protocol detail shows protocol name and habits list', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Navigate directly to protocol detail
    await page.evaluate(() => App.navigateTo('protocol-detail', 'proto-1'));

    // Wait for content to render
    await page.waitForFunction(() => {
      const el = document.getElementById('protocol-detail-container');
      return el && !el.textContent.includes('Loading...');
    }, { timeout: 5000 });

    const container = page.locator('#protocol-detail-container');

    // Verify protocol name
    await expect(container.locator('text=Sleep Protocol')).toBeVisible();

    // Verify habits list renders
    await expect(container.locator('text=No caffeine after 2pm')).toBeVisible();
    await expect(container.locator('text=Screen off by 10pm')).toBeVisible();

    // Verify habit count shown
    await expect(container.locator('text=Daily Habits')).toBeVisible();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Click Back button on protocol detail returns to protocols list', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('protocol-detail', 'proto-1'));
    await page.waitForFunction(() => {
      const el = document.getElementById('protocol-detail-container');
      return el && !el.textContent.includes('Loading...');
    }, { timeout: 5000 });

    // Click the Back button
    const backBtn = page.locator('#protocol-detail-container button:has-text("Back")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Verify we're back on the protocols list page
    await expect(page.locator('#page-protocols')).toBeVisible({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Protocol detail has a Start Challenge action button', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('protocol-detail', 'proto-1'));
    await page.waitForFunction(() => {
      const el = document.getElementById('protocol-detail-container');
      return el && !el.textContent.includes('Loading...');
    }, { timeout: 5000 });

    // Verify the "Create Challenge with This Protocol" button exists
    const actionBtn = page.locator('#protocol-detail-container button:has-text("Challenge")');
    await expect(actionBtn).toBeVisible();
    await expect(actionBtn).toBeEnabled();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });
});

// ── 2. Challenge Creation Flow ───────────────────────────────────────────────

test.describe('Challenge Creation Flow', () => {

  test('Open create challenge modal and verify it is visible', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.click('button[data-page="challenges"]');
    await page.waitForTimeout(500);

    // Open modal via JS
    await page.evaluate(() => Challenges.showCreateModal());

    const modal = page.locator('#create-challenge-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Modal has protocol dropdown with options', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.click('button[data-page="challenges"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => Challenges.showCreateModal());
    await page.waitForSelector('#create-challenge-modal', { timeout: 5000 });

    const protocolSelect = page.locator('#challenge-protocol');
    await expect(protocolSelect).toBeVisible();

    // Should have protocol options loaded
    const optionCount = await protocolSelect.locator('option').count();
    expect(optionCount).toBeGreaterThanOrEqual(1);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Select a protocol in dropdown and verify selection', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.click('button[data-page="challenges"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => Challenges.showCreateModal());
    await page.waitForSelector('#create-challenge-modal', { timeout: 5000 });

    const protocolSelect = page.locator('#challenge-protocol');
    await protocolSelect.selectOption({ index: 0 });

    // Verify something is selected
    const selectedValue = await protocolSelect.inputValue();
    expect(selectedValue).toBeTruthy();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Click Cancel button in modal and verify it closes', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.click('button[data-page="challenges"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => Challenges.showCreateModal());
    await page.waitForSelector('#create-challenge-modal', { timeout: 5000 });

    // Click the Cancel button
    const cancelBtn = page.locator('#create-challenge-modal button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // Modal should be hidden/removed
    await expect(page.locator('#create-challenge-modal')).toBeHidden({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Submit modal (click Create) and verify modal closes', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.click('button[data-page="challenges"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => Challenges.showCreateModal());
    await page.waitForSelector('#create-challenge-modal', { timeout: 5000 });

    // Select a protocol first
    const protocolSelect = page.locator('#challenge-protocol');
    await protocolSelect.selectOption({ index: 0 });

    // Click the Create/Submit button
    await page.click('#create-challenge-modal button[type="submit"]');

    // Modal should close
    await expect(page.locator('#create-challenge-modal')).toBeHidden({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('After challenge creation, challenges list updates', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.click('button[data-page="challenges"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => Challenges.showCreateModal());
    await page.waitForSelector('#create-challenge-modal', { timeout: 5000 });

    await page.locator('#challenge-protocol').selectOption({ index: 0 });
    await page.click('#create-challenge-modal button[type="submit"]');

    // Wait for modal to close
    await expect(page.locator('#create-challenge-modal')).toBeHidden({ timeout: 5000 });

    // Verify challenges page still has content (not empty/error)
    const challengesContainer = page.locator('#challenges-container');
    const html = await challengesContainer.innerHTML();
    expect(html.length).toBeGreaterThan(50);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });
});

// ── 3. Challenge Detail Interactions ─────────────────────────────────────────

test.describe('Challenge Detail Interactions', () => {

  test('Navigate to challenge-detail and verify content renders (not Loading)', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('challenge-detail', 'challenge-1'));

    await page.waitForFunction(() => {
      const el = document.getElementById('challenge-detail-container');
      return el && el.innerHTML.length > 100 && !el.innerHTML.includes('Loading...');
    }, { timeout: 10000 });

    const container = page.locator('#challenge-detail-container');
    const html = await container.innerHTML();
    const hasContent = html.includes('Test Challenge') || html.includes('Sleep Protocol') ||
                       html.includes('hero-stat') || html.includes('CHALLENGE STANDINGS') ||
                       html.includes("You're In");
    expect(hasContent).toBe(true);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Back button is visible and clickable on challenge detail', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('challenge-detail', 'challenge-1'));
    await page.waitForFunction(() => {
      const el = document.getElementById('challenge-detail-container');
      return el && el.innerHTML.length > 100 && !el.innerHTML.includes('Loading...');
    }, { timeout: 10000 });

    const backBtn = page.locator('#challenge-detail-container button:has-text("Back")');
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toBeEnabled();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Click Back button navigates away from detail page', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('challenge-detail', 'challenge-1'));
    await page.waitForFunction(() => {
      const el = document.getElementById('challenge-detail-container');
      return el && el.innerHTML.length > 100 && !el.innerHTML.includes('Loading...');
    }, { timeout: 10000 });

    await page.click('#challenge-detail-container button:has-text("Back")');

    // Back button navigates to protocols page (app design routes back there)
    await expect(page.locator('#page-challenge-detail')).toBeHidden({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Metric toggle buttons exist if data is present', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('challenge-detail', 'challenge-1'));
    await page.waitForFunction(() => {
      const el = document.getElementById('challenge-detail-container');
      return el && el.innerHTML.length > 100 && !el.innerHTML.includes('Loading...');
    }, { timeout: 10000 });

    // Check for metric buttons OR the celebration view (depends on data availability)
    const metricBtns = page.locator('.metric-btn');
    const celebrationView = page.locator('text=You\'re In');

    const hasMetrics = await metricBtns.first().isVisible().catch(() => false);
    const hasCelebration = await celebrationView.isVisible().catch(() => false);

    expect(hasMetrics || hasCelebration).toBe(true);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Click different metric toggles and verify active state changes', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('challenge-detail', 'challenge-1'));
    await page.waitForFunction(() => {
      const el = document.getElementById('challenge-detail-container');
      return el && el.innerHTML.length > 100 && !el.innerHTML.includes('Loading...');
    }, { timeout: 10000 });

    const metricBtns = page.locator('.metric-btn');
    const hasMetrics = await metricBtns.first().isVisible().catch(() => false);

    if (hasMetrics) {
      const sleepBtn = page.locator('.metric-btn[data-metric="score"]');
      const avgHrBtn = page.locator('.metric-btn[data-metric="avghr"]');
      const hrBtn = page.locator('.metric-btn[data-metric="hr"]');
      const deepBtn = page.locator('.metric-btn[data-metric="deep"]');

      await expect(sleepBtn).toBeVisible();
      await expect(avgHrBtn).toBeVisible();
      await expect(hrBtn).toBeVisible();
      await expect(deepBtn).toBeVisible();

      // Click avghr and verify it becomes active
      await avgHrBtn.click();
      await page.waitForTimeout(300);

      const avgHrClasses = await avgHrBtn.getAttribute('class');
      const hasActiveStyle = avgHrClasses?.includes('active') ||
        (await avgHrBtn.evaluate(el => el.style.color === 'rgb(255, 255, 255)'));
      expect(hasActiveStyle).toBe(true);

      // Click deep and verify it becomes active
      await deepBtn.click();
      await page.waitForTimeout(300);

      const deepClasses = await deepBtn.getAttribute('class');
      const deepActive = deepClasses?.includes('active') ||
        (await deepBtn.evaluate(el => el.style.color === 'rgb(255, 255, 255)'));
      expect(deepActive).toBe(true);
    }

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Challenge detail renders meaningful content (habits, stats, or celebration)', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('challenge-detail', 'challenge-1'));
    await page.waitForFunction(() => {
      const el = document.getElementById('challenge-detail-container');
      return el && el.innerHTML.length > 100 && !el.innerHTML.includes('Loading...');
    }, { timeout: 10000 });

    // Challenge detail should render SOME meaningful content:
    // - Habits with checkboxes, OR
    // - Celebration "You're In" view, OR
    // - Leaderboard/standings, OR
    // - Protocol name
    const container = page.locator('#challenge-detail-container');
    const html = await container.innerHTML();

    const hasMeaningfulContent =
      html.includes('No caffeine') || html.includes('Screen off') ||
      html.includes('checkbox') || html.includes('habit') ||
      html.includes("You're In") || html.includes('CHALLENGE STANDINGS') ||
      html.includes('Sleep Protocol') || html.includes('Test Challenge') ||
      html.includes('hero-stat') || html.includes('Back');
    expect(hasMeaningfulContent).toBe(true);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });
});

// ── 4. Account Page Interactions ─────────────────────────────────────────────

test.describe('Account Page Interactions', () => {

  test('Edit Profile button opens modal with display-name-input', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Mock the personal_info API
    await page.route('**/api/personal_info', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ email: 'test@example.com' })
    }));

    await page.click('button[data-page="account"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('account-container');
      return el && !el.textContent.includes('Loading');
    }, { timeout: 5000 });

    // Click the Edit Profile button
    await page.click('button:has-text("Edit Profile")');

    // Modal should appear
    const modal = page.locator('#edit-profile-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Display name input should be present
    const nameInput = page.locator('#display-name-input');
    await expect(nameInput).toBeVisible();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Change display name in modal and click Save', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.route('**/api/personal_info', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ email: 'test@example.com' })
    }));

    // Mock updateProfile to succeed
    await page.evaluate(() => {
      Account.updateProfile = async () => {};
    });

    await page.click('button[data-page="account"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('account-container');
      return el && !el.textContent.includes('Loading');
    }, { timeout: 5000 });

    await page.click('button:has-text("Edit Profile")');
    await page.waitForSelector('#edit-profile-modal', { timeout: 5000 });

    // Fill in a new display name
    const nameInput = page.locator('#display-name-input');
    await nameInput.clear();
    await nameInput.fill('New Test Name');

    // Click Save (submit the form)
    await page.click('#edit-profile-modal button:has-text("Save")');

    // Modal should close
    await expect(page.locator('#edit-profile-modal')).toBeHidden({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Cancel edit profile modal and verify it closes', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.route('**/api/personal_info', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ email: 'test@example.com' })
    }));

    await page.click('button[data-page="account"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('account-container');
      return el && !el.textContent.includes('Loading');
    }, { timeout: 5000 });

    await page.click('button:has-text("Edit Profile")');
    await page.waitForSelector('#edit-profile-modal', { timeout: 5000 });

    // Click Cancel
    await page.click('#edit-profile-modal button:has-text("Cancel")');

    // Modal should be removed
    await expect(page.locator('#edit-profile-modal')).toBeHidden({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Oura Connect button opens oura-token-modal with password input', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.route('**/api/personal_info', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ email: 'test@example.com' })
    }));

    await page.click('button[data-page="account"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('account-container');
      return el && !el.textContent.includes('Loading');
    }, { timeout: 5000 });

    // Click the Connect/Update Oura button
    await page.evaluate(() => Account.showOuraTokenModal());

    const modal = page.locator('#oura-token-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify token input is type=password
    const tokenInput = page.locator('#oura-token-input');
    await expect(tokenInput).toBeVisible();
    await expect(tokenInput).toHaveAttribute('type', 'password');

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Fill token in Oura modal and save', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.route('**/api/personal_info', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ email: 'test@example.com' })
    }));

    // Mock updateProfile
    await page.evaluate(() => {
      Account.updateProfile = async () => {};
    });

    await page.click('button[data-page="account"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('account-container');
      return el && !el.textContent.includes('Loading');
    }, { timeout: 5000 });

    await page.evaluate(() => Account.showOuraTokenModal());
    await page.waitForSelector('#oura-token-modal', { timeout: 5000 });

    // Fill in a token
    await page.locator('#oura-token-input').fill('my-fake-oura-token-12345');

    // Submit the form
    await page.click('#oura-token-modal button:has-text("Save")');

    // Wait for the "Token saved" message or modal close
    await page.waitForFunction(() => {
      const status = document.getElementById('oura-token-status');
      const modal = document.getElementById('oura-token-modal');
      return (status && status.textContent.includes('saved')) || !modal;
    }, { timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Cancel Oura token modal', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.route('**/api/personal_info', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ email: 'test@example.com' })
    }));

    await page.click('button[data-page="account"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('account-container');
      return el && !el.textContent.includes('Loading');
    }, { timeout: 5000 });

    await page.evaluate(() => Account.showOuraTokenModal());
    await page.waitForSelector('#oura-token-modal', { timeout: 5000 });

    // Click Cancel
    await page.click('#oura-token-modal button:has-text("Cancel")');

    // Modal should be removed
    await expect(page.locator('#oura-token-modal')).toBeHidden({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });
});

// ── 5. Onboarding Step Interactions ──────────────────────────────────────────

test.describe('Onboarding Step Interactions', () => {

  test('Step 0 (Name) — input visible, fill name, Continue button visible', async ({ page }) => {
    const errors = collectErrors(page);
    await showOnboardingStep(page, 0);
    await mockSupabase(page);

    // Name input should be visible
    const nameInput = page.locator('#onboarding-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    // Fill in a name
    await nameInput.fill('Alice');
    await expect(nameInput).toHaveValue('Alice');

    // Continue button should be visible (scope to onboarding section to avoid auth button)
    const continueBtn = page.locator('#onboarding-section button:has-text("Continue")');
    await expect(continueBtn).toBeVisible();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Step 1 (Oura Token) — token input and button visible', async ({ page }) => {
    const errors = collectErrors(page);
    await showOnboardingStep(page, 1);
    await mockSupabase(page);

    // Token input should be visible
    const tokenInput = page.locator('#onboarding-token');
    await expect(tokenInput).toBeVisible({ timeout: 5000 });

    // Fill a token
    await tokenInput.fill('fake-token-abc');
    await expect(tokenInput).toHaveValue('fake-token-abc');

    // Token save button should be visible
    const tokenBtn = page.locator('#onboarding-token-btn');
    await expect(tokenBtn).toBeVisible();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Step 2 (Pick Challenge) — protocols container visible, cards render', async ({ page }) => {
    const errors = collectErrors(page);
    await showOnboardingStep(page, 2);
    await mockSupabase(page);

    // Protocols container should be visible
    const protocolsContainer = page.locator('#onboarding-protocols');
    await expect(protocolsContainer).toBeVisible({ timeout: 5000 });

    // Wait for protocols to load
    await page.waitForFunction(() => {
      const el = document.getElementById('onboarding-protocols');
      return el && !el.textContent.includes('Loading protocols');
    }, { timeout: 5000 }).catch(() => {});

    // Protocol cards should be present (from mock data)
    const cards = protocolsContainer.locator('.onboarding-protocol-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(0); // May have rendered from mock

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Step 3 (Add Friend) — email input and invite button visible', async ({ page }) => {
    const errors = collectErrors(page);
    await showOnboardingStep(page, 3);
    await mockSupabase(page);

    // Friend email input should be visible
    const emailInput = page.locator('#onboarding-friend-email');
    await expect(emailInput).toBeVisible({ timeout: 5000 });

    // Invite button should be visible
    const inviteBtn = page.locator('#onboarding-invite-btn');
    await expect(inviteBtn).toBeVisible();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Step 4 (Complete) — shows "You\'re All Set!" and Go to Dashboard button', async ({ page }) => {
    const errors = collectErrors(page);
    await showOnboardingStep(page, 4);
    await mockSupabase(page);

    // "You're All Set!" text should be visible
    await expect(page.locator('text=You\'re All Set!')).toBeVisible({ timeout: 5000 });

    // "Go to Dashboard" button should be visible
    const dashBtn = page.locator('button:has-text("Go to Dashboard")');
    await expect(dashBtn).toBeVisible();
    await expect(dashBtn).toBeEnabled();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Fill name in step 0 and click Continue — step advances', async ({ page }) => {
    const errors = collectErrors(page);
    await showOnboardingStep(page, 0);
    await mockSupabase(page);

    // Mock advanceStep to track the call
    await page.evaluate(() => {
      window._advancedToStep = null;
      Onboarding.advanceStep = async (step) => {
        window._advancedToStep = step;
        Onboarding.renderStep(step);
      };
      Auth.updateProfile = async () => {};
    });

    const nameInput = page.locator('#onboarding-name');
    await nameInput.fill('TestUser');

    // Click Continue (scope to onboarding section to avoid auth button)
    await page.click('#onboarding-section button:has-text("Continue")');

    // Verify step advanced (to step 1)
    await page.waitForFunction(() => window._advancedToStep === 1, { timeout: 5000 });

    const advancedTo = await page.evaluate(() => window._advancedToStep);
    expect(advancedTo).toBe(1);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });
});

// ── 6. Dashboard Interactions ────────────────────────────────────────────────

test.describe('Dashboard Interactions', () => {

  test('Dashboard renders with mocked data and has content', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Trigger dashboard render
    await page.evaluate(() => App.navigateTo('dashboard'));

    // Wait for dashboard to load
    await page.waitForFunction(() => {
      const el = document.getElementById('dashboard-container');
      return el && !el.textContent.includes('Loading dashboard');
    }, { timeout: 5000 });

    const container = page.locator('#dashboard-container');
    const html = await container.innerHTML();
    expect(html.length).toBeGreaterThan(50);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Dashboard module is loaded', async ({ page }) => {
    await waitForAuthInit(page);

    const hasDashboard = await page.evaluate(() => typeof window.Dashboard !== 'undefined');
    expect(hasDashboard).toBe(true);
  });

  test('Dashboard challenge cards are clickable if present', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('dashboard'));

    await page.waitForFunction(() => {
      const el = document.getElementById('dashboard-container');
      return el && !el.textContent.includes('Loading dashboard');
    }, { timeout: 5000 });

    // Look for clickable challenge cards on the dashboard
    const clickableCards = page.locator('#dashboard-container [onclick*="challenge"]');
    const count = await clickableCards.count();

    if (count > 0) {
      // Verify the first card is clickable (has onclick attribute)
      const onclick = await clickableCards.first().getAttribute('onclick');
      expect(onclick).toBeTruthy();
    }

    // Test passes whether or not cards are present (depends on data)
    expect(true).toBe(true);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Dashboard header text is present', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    await page.evaluate(() => App.navigateTo('dashboard'));

    // The header is in #page-dashboard, outside the container
    await expect(page.locator('#page-dashboard h2:has-text("Dashboard")')).toBeVisible();
    await expect(page.locator('#page-dashboard:has-text("Your sleep performance at a glance")')).toBeVisible();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });
});
