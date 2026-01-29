// @ts-check
const { test, expect } = require('@playwright/test');
const {
  mockAuthenticatedState,
  clearAuthState,
  setupAuthenticatedPage,
  setupUnauthenticatedPage,
  injectMockModules,
  MOCK_USER,
  MOCK_SESSION
} = require('./auth');
const {
  MOCK_USER_2,
  MOCK_PROFILE,
  MOCK_SLEEP_DATA,
  generateBaselineSleepData,
  MOCK_FRIENDS,
  MOCK_FRIEND_REQUESTS,
  MOCK_CHALLENGE,
  MOCK_CHALLENGE_PARTICIPANTS,
  MOCK_CHALLENGE_INVITATIONS
} = require('./fixtures');

test.describe('Test Fixtures', () => {
  test('MOCK_USER has required fields', () => {
    expect(MOCK_USER).toHaveProperty('id');
    expect(MOCK_USER).toHaveProperty('email');
    expect(MOCK_USER).toHaveProperty('created_at');
    expect(MOCK_USER.email).toContain('@');
  });

  test('MOCK_USER_2 has required fields', () => {
    expect(MOCK_USER_2).toHaveProperty('id');
    expect(MOCK_USER_2).toHaveProperty('email');
    expect(MOCK_USER_2.id).not.toBe(MOCK_USER.id);
  });

  test('MOCK_SESSION has valid tokens', () => {
    expect(MOCK_SESSION).toHaveProperty('access_token');
    expect(MOCK_SESSION).toHaveProperty('refresh_token');
    expect(MOCK_SESSION).toHaveProperty('expires_at');
    expect(MOCK_SESSION.expires_at).toBeGreaterThan(Date.now() / 1000);
  });

  test('MOCK_PROFILE has onboarding completed', () => {
    expect(MOCK_PROFILE).toHaveProperty('onboarding_step');
    expect(MOCK_PROFILE.onboarding_step).toBeGreaterThanOrEqual(4);
  });

  test('MOCK_SLEEP_DATA contains valid sleep records', () => {
    expect(MOCK_SLEEP_DATA.length).toBeGreaterThan(0);
    MOCK_SLEEP_DATA.forEach(record => {
      expect(record).toHaveProperty('sleep_score');
      expect(record).toHaveProperty('pre_sleep_hr');
      expect(record).toHaveProperty('total_sleep_minutes');
      expect(record.sleep_score).toBeGreaterThanOrEqual(0);
      expect(record.sleep_score).toBeLessThanOrEqual(100);
    });
  });

  test('generateBaselineSleepData creates correct number of records', () => {
    const baseline = generateBaselineSleepData(MOCK_USER.id, 30);
    expect(baseline.length).toBe(30);
    baseline.forEach(record => {
      expect(record.user_id).toBe(MOCK_USER.id);
      expect(record).toHaveProperty('date');
      expect(record).toHaveProperty('sleep_score');
    });
  });

  test('MOCK_FRIENDS contains friend relationship data', () => {
    expect(MOCK_FRIENDS.length).toBeGreaterThan(0);
    MOCK_FRIENDS.forEach(friend => {
      expect(friend).toHaveProperty('user_id');
      expect(friend).toHaveProperty('friend_id');
      expect(friend).toHaveProperty('status');
    });
  });

  test('MOCK_FRIEND_REQUESTS contains pending requests', () => {
    expect(MOCK_FRIEND_REQUESTS.length).toBeGreaterThan(0);
    MOCK_FRIEND_REQUESTS.forEach(request => {
      expect(request.status).toBe('pending');
      expect(request).toHaveProperty('requester_profile');
    });
  });

  test('MOCK_CHALLENGE has required challenge fields', () => {
    expect(MOCK_CHALLENGE).toHaveProperty('id');
    expect(MOCK_CHALLENGE).toHaveProperty('name');
    expect(MOCK_CHALLENGE).toHaveProperty('metric');
    expect(MOCK_CHALLENGE).toHaveProperty('duration_days');
    expect(MOCK_CHALLENGE).toHaveProperty('start_date');
    expect(MOCK_CHALLENGE).toHaveProperty('end_date');
  });

  test('MOCK_CHALLENGE_PARTICIPANTS includes multiple participants', () => {
    expect(MOCK_CHALLENGE_PARTICIPANTS.length).toBeGreaterThanOrEqual(2);
    MOCK_CHALLENGE_PARTICIPANTS.forEach(participant => {
      expect(participant).toHaveProperty('user_id');
      expect(participant).toHaveProperty('baseline_value');
      expect(participant).toHaveProperty('current_value');
    });
  });

  test('MOCK_CHALLENGE_INVITATIONS contains pending invites', () => {
    expect(MOCK_CHALLENGE_INVITATIONS.length).toBeGreaterThan(0);
    MOCK_CHALLENGE_INVITATIONS.forEach(invite => {
      expect(invite.status).toBe('pending');
      expect(invite).toHaveProperty('challenge');
      expect(invite).toHaveProperty('inviter_profile');
    });
  });
});

test.describe('Auth Helpers', () => {
  test('auth module exports all required functions', () => {
    expect(typeof mockAuthenticatedState).toBe('function');
    expect(typeof clearAuthState).toBe('function');
    expect(typeof setupAuthenticatedPage).toBe('function');
    expect(typeof setupUnauthenticatedPage).toBe('function');
    expect(typeof injectMockModules).toBe('function');
  });

  test('auth module re-exports MOCK_USER and MOCK_SESSION', () => {
    expect(MOCK_USER).toBeDefined();
    expect(MOCK_SESSION).toBeDefined();
  });

  test('setupUnauthenticatedPage shows auth section', async ({ page }) => {
    await setupUnauthenticatedPage(page);
    await expect(page.locator('#auth-section')).toBeVisible();
  });

  test('injectMockModules sets test mode flag', async ({ page }) => {
    await injectMockModules(page, { testValue: 123 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const testMode = await page.evaluate(() => window.__TEST_MODE__);
    expect(testMode).toBe(true);

    const mockData = await page.evaluate(() => window.__MOCK_DATA__);
    expect(mockData).toEqual({ testValue: 123 });
  });

  test('clearAuthState removes auth tokens from localStorage', async ({ page }) => {
    // First set some auth data
    await page.addInitScript(() => {
      localStorage.setItem('sb-localhost-auth-token', JSON.stringify({ test: true }));
    });
    await page.goto('/');

    // Verify it was set
    const beforeClear = await page.evaluate(() =>
      localStorage.getItem('sb-localhost-auth-token')
    );
    expect(beforeClear).not.toBeNull();

    // Clear auth and reload
    await clearAuthState(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify it was cleared
    const afterClear = await page.evaluate(() =>
      localStorage.getItem('sb-localhost-auth-token')
    );
    expect(afterClear).toBeNull();
  });

  test('mockAuthenticatedState injects session data', async ({ page }) => {
    await mockAuthenticatedState(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that mock auth data was set
    const mockAuth = await page.evaluate(() => window.__MOCK_AUTH__);
    expect(mockAuth).toBeDefined();
    expect(mockAuth.user.email).toBe(MOCK_USER.email);
    expect(mockAuth.access_token).toBe(MOCK_SESSION.access_token);
  });
});
