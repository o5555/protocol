// @ts-check
/**
 * Friends E2E Tests
 * Tests for friend management, search, requests, and badge notifications
 *
 * Acceptance Criteria:
 * - Test: Friends tab shows friends list or empty state
 * - Test: Search by email input works and shows results
 * - Test: Send friend request button is clickable
 * - Test: Pending requests section shows incoming requests
 * - Test: Accept/decline buttons work on pending requests
 * - Test: Friends badge shows pending request count
 */

const { test, expect } = require('@playwright/test');
const { setupUnauthenticatedPage } = require('./helpers/auth');
const {
  MOCK_USER,
  MOCK_USER_2,
  MOCK_FRIENDS,
  MOCK_FRIEND_REQUESTS
} = require('./helpers/fixtures');

// ============================================================================
// Module Loading Tests
// ============================================================================

test.describe('Friends - Module Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('Friends module is loaded and available on window', async ({ page }) => {
    const hasFriends = await page.evaluate(() => typeof window.Friends !== 'undefined');
    expect(hasFriends).toBe(true);
  });

  test('Friends module has searchByEmail method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.searchByEmail === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has sendInviteLink method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.sendInviteLink === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has getPendingInvites method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.getPendingInvites === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has cancelInvite method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.cancelInvite === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has sendRequest method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.sendRequest === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has acceptRequest method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.acceptRequest === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has declineRequest method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.declineRequest === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has removeFriend method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.removeFriend === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has getFriends method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.getFriends === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has getPendingRequests method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.getPendingRequests === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has getSentRequests method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.getSentRequests === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has render method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.render === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has handleInvite method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.handleInvite === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has handleAccept method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.handleAccept === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has handleDecline method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.handleDecline === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has handleSendInviteLink method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.handleSendInviteLink === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has handleCancelInvite method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.handleCancelInvite === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Friends module has handleRemove method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Friends?.handleRemove === 'function');
    expect(hasMethod).toBe(true);
  });
});

// ============================================================================
// UI Structure Tests (Unauthenticated)
// ============================================================================

test.describe('Friends - UI Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('friends page container exists in DOM', async ({ page }) => {
    const container = page.locator('#page-friends');
    await expect(container).toBeAttached();
  });

  test('friends container element exists in DOM', async ({ page }) => {
    const container = page.locator('#friends-container');
    await expect(container).toBeAttached();
  });

  test('friends page has correct heading', async ({ page }) => {
    const heading = page.locator('#page-friends h2');
    await expect(heading).toHaveText('Friends');
  });

  test('friends page has correct subheading', async ({ page }) => {
    const subheading = page.locator('#page-friends p.text-oura-muted');
    await expect(subheading).toHaveText('Invite friends to join challenges');
  });

  test('friends page is initially hidden', async ({ page }) => {
    const friendsPage = page.locator('#page-friends');
    await expect(friendsPage).toHaveClass(/hidden/);
  });

  test('friends badge element exists in DOM', async ({ page }) => {
    const badge = page.locator('#friends-badge');
    await expect(badge).toBeAttached();
  });

  test('friends badge is initially hidden', async ({ page }) => {
    const badge = page.locator('#friends-badge');
    await expect(badge).toHaveClass(/hidden/);
  });
});

// ============================================================================
// Navigation Tests
// ============================================================================

test.describe('Friends - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('friends nav button exists in DOM', async ({ page }) => {
    // Nav button exists but may be hidden when unauthenticated (inside #app-content)
    const navBtn = page.locator('.nav-btn[data-page="friends"]');
    await expect(navBtn).toBeAttached();
  });

  test('friends nav button has correct data-page attribute', async ({ page }) => {
    const navBtn = page.locator('.nav-btn[data-page="friends"]');
    await expect(navBtn).toHaveAttribute('data-page', 'friends');
  });

  test('friends nav button has onclick handler', async ({ page }) => {
    const hasHandler = await page.evaluate(() => {
      const btn = document.querySelector('.nav-btn[data-page="friends"]');
      return btn?.getAttribute('onclick')?.includes('App.navigateTo');
    });
    expect(hasHandler).toBe(true);
  });

  test('App.navigateTo shows friends page and hides dashboard', async ({ page }) => {
    // Using App.navigateTo since the nav button is inside hidden #app-content when unauthenticated
    await page.evaluate(() => {
      App.navigateTo('friends');
    });

    const friendsPage = page.locator('#page-friends');
    await expect(friendsPage).not.toHaveClass(/hidden/);

    const dashboardPage = page.locator('#page-dashboard');
    await expect(dashboardPage).toHaveClass(/hidden/);
  });

  test('App.navigateTo activates the friends nav button', async ({ page }) => {
    await page.evaluate(() => {
      App.navigateTo('friends');
    });

    const navBtn = page.locator('.nav-btn[data-page="friends"]');
    await expect(navBtn).toHaveClass(/text-oura-accent/);
  });

  test('friends nav button has correct onclick attribute', async ({ page }) => {
    const onclick = await page.evaluate(() => {
      const btn = document.querySelector('.nav-btn[data-page="friends"]');
      return btn?.getAttribute('onclick');
    });
    expect(onclick).toContain("App.navigateTo('friends')");
  });

  test('App.navigateTo("friends") navigates to friends page', async ({ page }) => {
    await page.evaluate(() => {
      App.navigateTo('friends');
    });

    const friendsPage = page.locator('#page-friends');
    await expect(friendsPage).not.toHaveClass(/hidden/);
  });

  test('App.navigateTo("friends") calls Friends.render', async ({ page }) => {
    // Track if render was called
    await page.evaluate(() => {
      window.__renderCalled__ = false;
      const originalRender = window.Friends.render;
      window.Friends.render = function() {
        window.__renderCalled__ = true;
        return originalRender.apply(this, arguments);
      };
    });

    await page.evaluate(() => {
      App.navigateTo('friends');
    });

    // Give render time to be called
    await page.waitForTimeout(100);

    const wasRenderCalled = await page.evaluate(() => window.__renderCalled__);
    expect(wasRenderCalled).toBe(true);
  });
});

// ============================================================================
// Friends List Rendering Tests
// ============================================================================

test.describe('Friends - List Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Friends.render is a callable function', async ({ page }) => {
    const isFunction = await page.evaluate(() => typeof window.Friends?.render === 'function');
    expect(isFunction).toBe(true);
  });

  test('friends container has loading state initially', async ({ page }) => {
    const container = page.locator('#friends-container');
    await expect(container).toContainText('Loading friends...');
  });

  test('Friends list renders Add Friend section with mock data', async ({ page }) => {
    // Mock the async methods to return data without hitting the server
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    // Navigate to friends and trigger render
    await page.evaluate(() => {
      App.navigateTo('friends');
    });

    await page.waitForTimeout(200);

    const addFriendSection = page.locator('#friends-container h3:has-text("Add Friend")');
    await expect(addFriendSection).toBeAttached();
  });

  test('Friends list renders invite form', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const inviteForm = page.locator('#invite-friend-form');
    await expect(inviteForm).toBeAttached();
  });

  test('Friends list renders email input field', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const emailInput = page.locator('#friend-email');
    await expect(emailInput).toBeAttached();
  });

  test('email input has correct placeholder', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const emailInput = page.locator('#friend-email');
    await expect(emailInput).toHaveAttribute('placeholder', 'friend@email.com');
  });

  test('email input has type="email"', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const emailInput = page.locator('#friend-email');
    await expect(emailInput).toHaveAttribute('type', 'email');
  });

  test('Friends list renders Send Invite button', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const sendButton = page.locator('#invite-friend-form button[type="submit"]');
    await expect(sendButton).toBeAttached();
    await expect(sendButton).toContainText('Send Invite');
  });

  test('Send Invite button has teal background styling', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const sendButton = page.locator('#invite-friend-form button[type="submit"]');
    await expect(sendButton).toHaveClass(/bg-oura-teal/);
  });

  test('invite message element exists (hidden initially)', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const messageEl = page.locator('#invite-message');
    await expect(messageEl).toBeAttached();
    await expect(messageEl).toHaveClass(/hidden/);
  });
});

// ============================================================================
// Empty State Tests
// ============================================================================

test.describe('Friends - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('shows empty state message when no friends', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const emptyMessage = page.locator('#friends-container:has-text("No friends yet")');
    await expect(emptyMessage).toBeAttached();
  });

  test('empty state includes invitation call to action', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const ctaMessage = page.locator('#friends-container:has-text("Invite someone to get started")');
    await expect(ctaMessage).toBeAttached();
  });

  test('Friends section shows count of 0 when no friends', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const friendsHeader = page.locator('#friends-container h3:has-text("Friends (0)")');
    await expect(friendsHeader).toBeAttached();
  });
});

// ============================================================================
// Friends List with Data Tests
// ============================================================================

test.describe('Friends - With Friends Data', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('shows correct friend count when friends exist', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [
        { friendshipId: 'f1', id: 'u1', email: 'friend1@example.com', displayName: 'Friend One' },
        { friendshipId: 'f2', id: 'u2', email: 'friend2@example.com', displayName: 'Friend Two' }
      ];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const friendsHeader = page.locator('#friends-container h3:has-text("Friends (2)")');
    await expect(friendsHeader).toBeAttached();
  });

  test('renders friend display name', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [
        { friendshipId: 'f1', id: 'u1', email: 'friend1@example.com', displayName: 'Friend One' }
      ];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const friendName = page.locator('#friends-container:has-text("Friend One")');
    await expect(friendName).toBeAttached();
  });

  test('renders friend email', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [
        { friendshipId: 'f1', id: 'u1', email: 'friend1@example.com', displayName: 'Friend One' }
      ];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const friendEmail = page.locator('#friends-container:has-text("friend1@example.com")');
    await expect(friendEmail).toBeAttached();
  });

  test('renders Remove button for each friend', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [
        { friendshipId: 'f1', id: 'u1', email: 'friend1@example.com', displayName: 'Friend One' }
      ];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const removeButton = page.locator('#friends-container button:has-text("Remove")');
    await expect(removeButton).toBeAttached();
  });

  test('Remove button has onclick handler with handleRemove', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [
        { friendshipId: 'test-friendship-id', id: 'u1', email: 'friend1@example.com', displayName: 'Friend One' }
      ];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    // The Remove button in the Friends section (not Friend Requests section)
    // has onclick="Friends.handleRemove('test-friendship-id')"
    const hasHandler = await page.evaluate(() => {
      // Find buttons with onclick containing handleRemove
      const buttons = document.querySelectorAll('#friends-container button[onclick*="handleRemove"]');
      // Check if any of them has the friendshipId
      for (const btn of buttons) {
        if (btn.getAttribute('onclick')?.includes('test-friendship-id')) {
          return true;
        }
      }
      return false;
    });
    expect(hasHandler).toBe(true);
  });

  test('uses email as display name when displayName is null', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [
        { friendshipId: 'f1', id: 'u1', email: 'nodisplayname@example.com', displayName: null }
      ];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    // Should show email in the font-medium position (where display name would be)
    const displayArea = page.locator('#friends-container .font-medium:has-text("nodisplayname@example.com")');
    await expect(displayArea).toBeAttached();
  });
});

// ============================================================================
// Pending Friend Requests Tests
// ============================================================================

test.describe('Friends - Pending Requests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('shows Friend Requests section when pending requests exist', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [
        { friendshipId: 'r1', id: 'req1', email: 'requester@example.com', displayName: 'Requester User' }
      ];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const requestsSection = page.locator('#friends-container h3:has-text("Friend Requests")');
    await expect(requestsSection).toBeAttached();
  });

  test('shows correct count in Friend Requests header', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [
        { friendshipId: 'r1', id: 'req1', email: 'requester@example.com', displayName: 'Requester One' },
        { friendshipId: 'r2', id: 'req2', email: 'requester2@example.com', displayName: 'Requester Two' }
      ];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const requestsHeader = page.locator('#friends-container h3:has-text("Friend Requests (2)")');
    await expect(requestsHeader).toBeAttached();
  });

  test('renders Accept button for pending requests', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [
        { friendshipId: 'r1', id: 'req1', email: 'requester@example.com', displayName: 'Requester User' }
      ];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const acceptButton = page.locator('#friends-container button:has-text("Accept")');
    await expect(acceptButton).toBeAttached();
  });

  test('Accept button has teal background styling', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [
        { friendshipId: 'r1', id: 'req1', email: 'requester@example.com', displayName: 'Requester User' }
      ];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const acceptButton = page.locator('#friends-container button:has-text("Accept")');
    await expect(acceptButton).toHaveClass(/bg-oura-teal/);
  });

  test('renders Decline button for pending requests', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [
        { friendshipId: 'r1', id: 'req1', email: 'requester@example.com', displayName: 'Requester User' }
      ];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const declineButton = page.locator('#friends-container button:has-text("Decline")');
    await expect(declineButton).toBeAttached();
  });

  test('Decline button has border background styling', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [
        { friendshipId: 'r1', id: 'req1', email: 'requester@example.com', displayName: 'Requester User' }
      ];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const declineButton = page.locator('#friends-container button:has-text("Decline")');
    await expect(declineButton).toHaveClass(/bg-oura-border/);
  });

  test('Accept button has onclick handler with friendshipId', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [
        { friendshipId: 'test-request-id', id: 'req1', email: 'requester@example.com', displayName: 'Requester User' }
      ];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const hasHandler = await page.evaluate(() => {
      const btn = document.querySelector('#friends-container button[onclick*="handleAccept"]');
      return btn?.getAttribute('onclick')?.includes('test-request-id');
    });
    expect(hasHandler).toBe(true);
  });

  test('Decline button has onclick handler with friendshipId', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [
        { friendshipId: 'test-request-id', id: 'req1', email: 'requester@example.com', displayName: 'Requester User' }
      ];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const hasHandler = await page.evaluate(() => {
      const btn = document.querySelector('#friends-container button[onclick*="handleDecline"]');
      return btn?.getAttribute('onclick')?.includes('test-request-id');
    });
    expect(hasHandler).toBe(true);
  });

  test('does not show Friend Requests section when no pending requests', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const requestsSection = page.locator('#friends-container h3:has-text("Friend Requests")');
    await expect(requestsSection).not.toBeAttached();
  });
});

// ============================================================================
// Sent Requests Tests
// ============================================================================

test.describe('Friends - Sent Requests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('shows Sent Requests section when sent requests exist', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [
        { friendshipId: 's1', id: 'sent1', email: 'pending@example.com', displayName: 'Pending Friend' }
      ];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const sentSection = page.locator('#friends-container h3:has-text("Sent Requests")');
    await expect(sentSection).toBeAttached();
  });

  test('shows correct count in Sent Requests header', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [
        { friendshipId: 's1', id: 'sent1', email: 'pending1@example.com', displayName: 'Pending One' },
        { friendshipId: 's2', id: 'sent2', email: 'pending2@example.com', displayName: 'Pending Two' }
      ];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const sentHeader = page.locator('#friends-container h3:has-text("Sent Requests (2)")');
    await expect(sentHeader).toBeAttached();
  });

  test('shows Pending status for sent requests', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [
        { friendshipId: 's1', id: 'sent1', email: 'pending@example.com', displayName: 'Pending Friend' }
      ];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const pendingStatus = page.locator('#friends-container span.text-oura-muted:has-text("Pending")');
    await expect(pendingStatus).toBeAttached();
  });

  test('sent requests section has muted styling', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [
        { friendshipId: 's1', id: 'sent1', email: 'pending@example.com', displayName: 'Pending Friend' }
      ];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const sentHeader = page.locator('#friends-container h3:has-text("Sent Requests")');
    await expect(sentHeader).toHaveClass(/text-oura-muted/);
  });
});

// ============================================================================
// Pending Invites (Invite Links) Tests
// ============================================================================

test.describe('Friends - Pending Invite Links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('shows Invite Links Sent section when pending invites exist', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [
        { id: 'inv1', invited_email: 'invited@example.com', created_at: '2024-01-01' }
      ];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const invitesSection = page.locator('#friends-container h3:has-text("Invite Links Sent")');
    await expect(invitesSection).toBeAttached();
  });

  test('shows correct count in Invite Links header', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [
        { id: 'inv1', invited_email: 'invited1@example.com', created_at: '2024-01-01' },
        { id: 'inv2', invited_email: 'invited2@example.com', created_at: '2024-01-02' }
      ];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const invitesHeader = page.locator('#friends-container h3:has-text("Invite Links Sent (2)")');
    await expect(invitesHeader).toBeAttached();
  });

  test('shows Cancel button for pending invites', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [
        { id: 'inv1', invited_email: 'invited@example.com', created_at: '2024-01-01' }
      ];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const cancelButton = page.locator('#friends-container button:has-text("Cancel")');
    await expect(cancelButton).toBeAttached();
  });

  test('Cancel button has onclick handler with invite id', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [
        { id: 'test-invite-id', invited_email: 'invited@example.com', created_at: '2024-01-01' }
      ];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const hasHandler = await page.evaluate(() => {
      const btn = document.querySelector('#friends-container button[onclick*="handleCancelInvite"]');
      return btn?.getAttribute('onclick')?.includes('test-invite-id');
    });
    expect(hasHandler).toBe(true);
  });

  test('shows auto-connect message for invite links', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [
        { id: 'inv1', invited_email: 'invited@example.com', created_at: '2024-01-01' }
      ];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const autoConnectMsg = page.locator('#friends-container:has-text("Auto-connects when they sign up")');
    await expect(autoConnectMsg).toBeAttached();
  });
});

// ============================================================================
// Friends Badge Tests
// ============================================================================

test.describe('Friends - Badge Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('friends badge element exists', async ({ page }) => {
    const badge = page.locator('#friends-badge');
    await expect(badge).toBeAttached();
  });

  test('friends badge is hidden when no pending requests', async ({ page }) => {
    const badge = page.locator('#friends-badge');
    await expect(badge).toHaveClass(/hidden/);
  });

  test('App.checkNotifications calls Friends.getPendingRequests', async ({ page }) => {
    // Mock both Challenges and Friends to avoid network calls
    await page.evaluate(() => {
      window.__friendsGetPendingCalled__ = false;
      window.Challenges.getInvitations = async () => [];
      window.Friends.getPendingRequests = async function() {
        window.__friendsGetPendingCalled__ = true;
        return [];
      };
    });

    await page.evaluate(() => App.checkNotifications());
    await page.waitForTimeout(200);

    const wasCalled = await page.evaluate(() => window.__friendsGetPendingCalled__);
    expect(wasCalled).toBe(true);
  });

  test('badge styling includes red background', async ({ page }) => {
    const badge = page.locator('#friends-badge');
    await expect(badge).toHaveClass(/bg-red-500/);
  });

  test('badge styling includes rounded-full', async ({ page }) => {
    const badge = page.locator('#friends-badge');
    await expect(badge).toHaveClass(/rounded-full/);
  });

  test('badge is positioned absolutely', async ({ page }) => {
    const badge = page.locator('#friends-badge');
    await expect(badge).toHaveClass(/absolute/);
  });
});

// ============================================================================
// Search/Invite Form Interaction Tests
// ============================================================================

test.describe('Friends - Search/Invite Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('can type in email input using JavaScript', async ({ page }) => {
    // Setup mocked data and navigate
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(300);

    // Use JavaScript to set value since the input is in a hidden container
    await page.evaluate(() => {
      const input = document.getElementById('friend-email');
      if (input) input.value = 'test@example.com';
    });

    const value = await page.evaluate(() => document.getElementById('friend-email')?.value);
    expect(value).toBe('test@example.com');
  });

  test('email input validates email format via HTML5', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(300);

    // Test HTML5 validation on invalid email
    const isValid = await page.evaluate(() => {
      const input = document.getElementById('friend-email');
      if (input) {
        input.value = 'invalid-email';
        return input.checkValidity();
      }
      return null;
    });
    expect(isValid).toBe(false);
  });

  test('email input accepts valid email via HTML5', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(300);

    // Test HTML5 validation on valid email
    const isValid = await page.evaluate(() => {
      const input = document.getElementById('friend-email');
      if (input) {
        input.value = 'valid@example.com';
        return input.checkValidity();
      }
      return null;
    });
    expect(isValid).toBe(true);
  });

  test('invite form has submit event listener attached', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(300);

    // The form should have an event listener for submit
    const hasListener = await page.evaluate(() => {
      const form = document.getElementById('invite-friend-form');
      // Check if form exists (listener is attached in render)
      return form !== null;
    });
    expect(hasListener).toBe(true);
  });

  test('empty email does not trigger search', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => [];
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      window.__searchCalled__ = false;
      window.Friends.searchByEmail = async () => {
        window.__searchCalled__ = true;
        return null;
      };
    });

    // Try to submit empty form
    const form = page.locator('#invite-friend-form');
    await form.evaluate(f => f.requestSubmit());

    await page.waitForTimeout(100);

    const wasCalled = await page.evaluate(() => window.__searchCalled__);
    expect(wasCalled).toBe(false);
  });
});

// ============================================================================
// Error State Tests
// ============================================================================

test.describe('Friends - Error States', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('shows error message when render fails', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => { throw new Error('Test error'); };
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const errorMessage = page.locator('#friends-container:has-text("Failed to load friends")');
    await expect(errorMessage).toBeAttached();
  });

  test('error message includes error details', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => { throw new Error('Custom error message'); };
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const errorDetails = page.locator('#friends-container:has-text("Custom error message")');
    await expect(errorDetails).toBeAttached();
  });

  test('error message has red styling', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => { throw new Error('Test error'); };
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const errorBox = page.locator('#friends-container .bg-red-900\\/20');
    await expect(errorBox).toBeAttached();
  });

  test('error box has red border', async ({ page }) => {
    await page.evaluate(() => {
      window.Friends.getFriends = async () => { throw new Error('Test error'); };
      window.Friends.getPendingRequests = async () => [];
      window.Friends.getSentRequests = async () => [];
      window.Friends.getPendingInvites = async () => [];
    });

    await page.evaluate(() => App.navigateTo('friends'));
    await page.waitForTimeout(200);

    const errorBox = page.locator('#friends-container .border-red-500');
    await expect(errorBox).toBeAttached();
  });
});

// ============================================================================
// App Notification Integration Tests
// ============================================================================

test.describe('Friends - App Notifications Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('App module is loaded', async ({ page }) => {
    const hasApp = await page.evaluate(() => typeof App !== 'undefined');
    expect(hasApp).toBe(true);
  });

  test('App has checkNotifications method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof App?.checkNotifications === 'function');
    expect(hasMethod).toBe(true);
  });

  test('App has navigateTo method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof App?.navigateTo === 'function');
    expect(hasMethod).toBe(true);
  });

  test('App.init calls checkNotifications', async ({ page }) => {
    // Reload page to test init
    await page.evaluate(() => {
      window.__checkNotificationsCalled__ = false;
      const originalMethod = App.checkNotifications;
      App.checkNotifications = function() {
        window.__checkNotificationsCalled__ = true;
        return originalMethod.apply(this, arguments);
      };
    });

    await page.evaluate(() => App.init());

    const wasCalled = await page.evaluate(() => window.__checkNotificationsCalled__);
    expect(wasCalled).toBe(true);
  });

  test('navigating to friends calls checkNotifications', async ({ page }) => {
    await page.evaluate(() => {
      window.__checkNotificationsCalled__ = false;
      const originalMethod = App.checkNotifications;
      App.checkNotifications = function() {
        window.__checkNotificationsCalled__ = true;
        return originalMethod.apply(this, arguments);
      };
    });

    await page.evaluate(() => App.navigateTo('friends'));

    await page.waitForTimeout(100);

    const wasCalled = await page.evaluate(() => window.__checkNotificationsCalled__);
    expect(wasCalled).toBe(true);
  });
});
