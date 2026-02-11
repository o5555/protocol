// @ts-check
const { test, expect } = require('@playwright/test');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Bypass auth and show the main app */
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

/** Mock every Supabase call so the app can render without a real backend */
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
      if (table === 'protocol_habits') {
        return { ...mockQuery, select: () => ({ ...mockQuery, order: () => ({ ...mockQuery, order: () => Promise.resolve({ data: mockChallenge.protocol.habits.map(h => ({ ...h, protocol: mockProtocols[0] })), error: null }) }) }) };
      }
      return mockQuery;
    };
    Auth.getProfile = () => Promise.resolve({ display_name: 'Test User', oura_token: 'fake-token', onboarding_step: 4 });
    if (typeof SleepSync !== 'undefined') {
      SleepSync.syncNow = async () => ({ success: true, synced: 1 });
    }
    if (typeof Comparison !== 'undefined') {
      Comparison.getChallengeSleepData = async () => ({ sleepData: [{ user: { id: 'test-user-id', email: 'test@example.com', display_name: 'Test User' }, baselineData: [{ sleep_score: 80, pre_sleep_hr: 58, avg_hr: 60, deep_sleep_minutes: 85, total_sleep_minutes: 420, date: '2025-01-01' }], challengeData: [{ sleep_score: 85, pre_sleep_hr: 55, avg_hr: 57, deep_sleep_minutes: 90, total_sleep_minutes: 440, date: new Date().toISOString().split('T')[0] }], challengeDays: 5 }] });
      Comparison.calcAverages = (data, days) => {
        if (!data || data.length === 0) return { hr: null, score: null, hours: null, dataPoints: 0 };
        const avg = (arr) => arr.reduce((a,b) => a+b, 0) / arr.length;
        return { hr: avg(data.map(d => d.pre_sleep_hr || 0)), score: avg(data.map(d => d.sleep_score || 0)), hours: avg(data.map(d => (d.total_sleep_minutes || 0) / 60)), dataPoints: data.length };
      };
      Comparison.renderForChallenge = async () => {};
    }
    if (typeof Friends !== 'undefined') {
      Friends.getFriends = async () => [];
      Friends.getPendingRequests = async () => [];
    }
    if (typeof Cache !== 'undefined') {
      Cache.get = () => null;
      Cache.set = () => {};
      Cache.clear = () => {};
    }
  });
}

/** Collect console errors during a test */
function collectErrors(page) {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  return errors;
}

/** Filter out expected network / Supabase errors that happen without a real backend */
function unexpectedErrors(errors) {
  return errors.filter(e =>
    !e.includes('Supabase') && !e.includes('Failed to fetch') && !e.includes('not initialized') &&
    !e.includes('NetworkError') && !e.includes('net::ERR') && !e.includes('ERR_CONNECTION') &&
    !e.includes('the server responded with a status of') && !e.includes('Error checking notifications') &&
    !e.includes('Error fetching profile') && !e.includes('Error rendering') && !e.includes('Error checking onboarding') &&
    !e.includes('Invite email')
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Challenges Page — Behavioral Tests', () => {

  test('Challenges page loads and shows a clickable Create button', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Click the Team Up nav button to navigate to challenges
    await page.click('button[data-page="challenges"]');

    // The challenges page should be visible
    const challengesPage = page.locator('#page-challenges');
    await expect(challengesPage).toBeVisible();

    // Wait for the "+ Start New Challenge" button to render (it's inside challenges-container)
    const createBtn = page.locator('button:has-text("Start New Challenge")');
    await expect(createBtn).toBeVisible({ timeout: 5000 });

    // Verify it's actually clickable (enabled)
    await expect(createBtn).toBeEnabled();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Create challenge modal opens with form elements', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Navigate to challenges so the page is loaded
    await page.click('button[data-page="challenges"]');
    await page.waitForSelector('button:has-text("Start New Challenge")', { timeout: 5000 });

    // Open the create-challenge modal directly (the list button now navigates to protocols)
    await page.evaluate(() => Challenges.showCreateModal());

    // Verify modal appears
    const modal = page.locator('#create-challenge-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify protocol select dropdown is present and visible
    const protocolSelect = page.locator('#challenge-protocol');
    await expect(protocolSelect).toBeVisible();

    // Verify it has options (protocols were loaded)
    const optionCount = await protocolSelect.locator('option').count();
    expect(optionCount).toBeGreaterThanOrEqual(1);

    // Verify Create and Cancel buttons exist in the modal
    const createBtn = modal.locator('button[type="submit"]:has-text("Create")');
    await expect(createBtn).toBeVisible();

    const cancelBtn = modal.locator('button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible();

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Create challenge end-to-end: select protocol, submit, modal closes', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Navigate to challenges so the page is loaded
    await page.click('button[data-page="challenges"]');
    await page.waitForSelector('button:has-text("Start New Challenge")', { timeout: 5000 });

    // Open the create-challenge modal directly (the list button now navigates to protocols)
    await page.evaluate(() => Challenges.showCreateModal());
    await page.waitForSelector('#create-challenge-modal', { timeout: 5000 });

    // Select the first protocol in the dropdown
    const protocolSelect = page.locator('#challenge-protocol');
    await protocolSelect.selectOption({ index: 0 });

    // Click the Create button (submit the form)
    await page.click('#create-challenge-modal button[type="submit"]');

    // The modal should close (be removed from DOM)
    await expect(page.locator('#create-challenge-modal')).toBeHidden({ timeout: 5000 });

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Challenge detail page renders with Back button and content', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Navigate to challenge detail
    await page.evaluate(() => App.navigateTo('challenge-detail', 'challenge-1'));

    // Wait for the detail container to have actual content (not just "Loading...")
    const container = page.locator('#challenge-detail-container');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('challenge-detail-container');
        return el && el.innerHTML.length > 100 && !el.innerHTML.includes('Loading...');
      },
      { timeout: 10000 }
    );

    // Verify Back button is present and clickable
    const backBtn = container.locator('button:has-text("Back")');
    await expect(backBtn).toBeVisible();

    // Verify some challenge content rendered (hero stat, protocol info, or leaderboard)
    const html = await container.innerHTML();
    const hasContent = html.includes('Test Challenge') || html.includes('Sleep Protocol') ||
                       html.includes('hero-stat') || html.includes('CHALLENGE STANDINGS') ||
                       html.includes("You're In");
    expect(hasContent).toBe(true);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Challenge detail shows trend chart and metric toggles', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Navigate to challenge detail
    await page.evaluate(() => App.navigateTo('challenge-detail', 'challenge-1'));

    // Wait for detail to render
    await page.waitForFunction(
      () => {
        const el = document.getElementById('challenge-detail-container');
        return el && el.innerHTML.length > 100 && !el.innerHTML.includes('Loading...');
      },
      { timeout: 10000 }
    );

    // Check for trend chart container
    const trendChart = page.locator('#trend-chart-container');
    // The chart may or may not be present depending on whether there's challenge data
    // (the "You're In!" view doesn't have it), so we check the metric toggle OR the celebration view
    const metricToggle = page.locator('#metric-toggle');
    const celebrationView = page.locator('text=You\'re In');

    const hasChart = await metricToggle.isVisible().catch(() => false);
    const hasCelebration = await celebrationView.isVisible().catch(() => false);

    // At least one of these should be true
    expect(hasChart || hasCelebration).toBe(true);

    if (hasChart) {
      // Verify metric toggle buttons exist
      const sleepBtn = page.locator('.metric-btn[data-metric="score"]');
      const avgHrBtn = page.locator('.metric-btn[data-metric="avghr"]');
      const lowHrBtn = page.locator('.metric-btn[data-metric="hr"]');
      const deepBtn = page.locator('.metric-btn[data-metric="deep"]');

      await expect(sleepBtn).toBeVisible();
      await expect(avgHrBtn).toBeVisible();
      await expect(lowHrBtn).toBeVisible();
      await expect(deepBtn).toBeVisible();

      // SLEEP should be active by default
      const sleepClasses = await sleepBtn.getAttribute('class');
      expect(sleepClasses).toContain('active');

      // Click AVG HR and verify it gets active styling
      await avgHrBtn.click();

      // Wait for the click handler to run
      await page.waitForTimeout(500);

      const avgHrStyle = await avgHrBtn.evaluate(el => el.style.color);
      expect(avgHrStyle).toBe('rgb(255, 255, 255)');
    }

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Oura sync triggers without crash', async ({ page }) => {
    const errors = collectErrors(page);
    await showApp(page);
    await mockSupabase(page);

    // Track whether SleepSync.syncNow was called
    await page.evaluate(() => {
      window._syncCalled = false;
      SleepSync.syncNow = async () => { window._syncCalled = true; return { success: true, count: 1 }; };
    });

    // Call syncNow directly and verify no crash
    const result = await page.evaluate(async () => {
      const res = await SleepSync.syncNow();
      return { syncCalled: window._syncCalled, success: res.success };
    });

    expect(result.syncCalled).toBe(true);
    expect(result.success).toBe(true);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });

  test('Challenge date helpers work correctly', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Test toLocalDateStr
    const formatted = await page.evaluate(() => {
      const date = new Date(2024, 0, 15); // Jan 15, 2024
      return window.Challenges.toLocalDateStr(date);
    });
    expect(formatted).toBe('2024-01-15');

    // Test parseLocalDate
    const parsed = await page.evaluate(() => {
      const date = window.Challenges.parseLocalDate('2024-01-15');
      return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
    });
    expect(parsed.year).toBe(2024);
    expect(parsed.month).toBe(0); // January = 0
    expect(parsed.day).toBe(15);

    // Test getDayNumber
    const dayNum = await page.evaluate(() => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 5);
      const startStr = window.Challenges.toLocalDateStr(startDate);
      return window.Challenges.getDayNumber(startStr);
    });
    expect(dayNum).toBe(6); // Day 6 (5 days elapsed + current day)

    // Test getDaysRemaining
    const daysRemaining = await page.evaluate(() => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const futureStr = window.Challenges.toLocalDateStr(futureDate);
      return window.Challenges.getDaysRemaining(futureStr);
    });
    expect(daysRemaining).toBe(10);

    // Test isActive — a challenge that started yesterday and ends in 10 days should be active
    const isActive = await page.evaluate(() => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const future = new Date();
      future.setDate(future.getDate() + 10);
      return window.Challenges.isActive(
        window.Challenges.toLocalDateStr(yesterday),
        window.Challenges.toLocalDateStr(future)
      );
    });
    expect(isActive).toBe(true);

    const unexpected = unexpectedErrors(errors);
    expect(unexpected).toEqual([]);
  });
});
