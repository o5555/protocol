// @ts-check
/**
 * Auth helpers for E2E tests
 * Provides utilities to mock authenticated state via localStorage/Supabase session injection
 */

const { MOCK_USER, MOCK_SESSION } = require('./fixtures');

/**
 * Mock authenticated state by injecting session into localStorage
 * This bypasses actual Supabase authentication for testing
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {object} [user] - Optional custom user object (defaults to MOCK_USER)
 * @param {object} [session] - Optional custom session object (defaults to MOCK_SESSION)
 */
async function mockAuthenticatedState(page, user = MOCK_USER, session = MOCK_SESSION) {
  // Supabase stores session in localStorage with a key like 'sb-<project-ref>-auth-token'
  // We need to inject this before the page loads the Supabase client

  const authData = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: 'bearer',
    user: {
      id: user.id,
      email: user.email,
      aud: 'authenticated',
      role: 'authenticated',
      email_confirmed_at: new Date().toISOString(),
      created_at: user.created_at,
      updated_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {}
    }
  };

  // Set localStorage before navigating to inject the session
  await page.addInitScript((data) => {
    // Store the mock session - Supabase uses a key pattern like 'sb-<ref>-auth-token'
    // We'll use a generic key that works with any project ref
    const keys = Object.keys(localStorage).filter(k => k.includes('-auth-token'));
    if (keys.length > 0) {
      localStorage.setItem(keys[0], JSON.stringify(data));
    } else {
      // Fallback: use a generic key pattern (will be picked up if Supabase client is configured)
      localStorage.setItem('sb-localhost-auth-token', JSON.stringify(data));
    }

    // Also set the mock auth data in a known location for our test setup
    window.__MOCK_AUTH__ = data;
  }, authData);
}

/**
 * Clear authenticated state from localStorage
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
async function clearAuthState(page) {
  await page.addInitScript(() => {
    // Clear any Supabase auth tokens
    const keys = Object.keys(localStorage).filter(k => k.includes('-auth-token'));
    keys.forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('sb-localhost-auth-token');

    // Clear mock auth
    delete window.__MOCK_AUTH__;
  });
}

/**
 * Setup page with mocked authentication before each test
 * Use in beforeEach hook for authenticated test flows
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {object} [options] - Configuration options
 * @param {object} [options.user] - Custom user object
 * @param {object} [options.session] - Custom session object
 */
async function setupAuthenticatedPage(page, options = {}) {
  await mockAuthenticatedState(page, options.user, options.session);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

/**
 * Setup page for unauthenticated (logged out) state
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
async function setupUnauthenticatedPage(page) {
  await clearAuthState(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

/**
 * Inject mock window modules for testing
 * This mocks the SupabaseClient and Auth modules to return test data
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {object} [mockData] - Optional mock data overrides
 */
async function injectMockModules(page, mockData = {}) {
  await page.addInitScript((data) => {
    // Wait for window to be ready
    window.__TEST_MODE__ = true;
    window.__MOCK_DATA__ = data;
  }, mockData);
}

module.exports = {
  mockAuthenticatedState,
  clearAuthState,
  setupAuthenticatedPage,
  setupUnauthenticatedPage,
  injectMockModules,
  MOCK_USER,
  MOCK_SESSION
};
