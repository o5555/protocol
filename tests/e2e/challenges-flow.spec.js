// @ts-check
/**
 * Challenges E2E Tests
 * Tests for challenge creation, management, and invitation flows
 *
 * Acceptance Criteria:
 * - Test: Create challenge modal opens and has required fields (name, duration, metric)
 * - Test: Challenge form validation works (required fields, valid dates)
 * - Test: Challenges list displays active and completed challenges
 * - Test: Challenge detail view shows participants and progress
 * - Test: Invite friends modal opens from challenge detail
 * - Test: Pending invitations badge shows correct count
 */

const { test, expect } = require('@playwright/test');
const { setupUnauthenticatedPage } = require('./helpers/auth');
const {
  MOCK_CHALLENGE,
  MOCK_CHALLENGE_PARTICIPANTS,
  MOCK_CHALLENGE_INVITATIONS
} = require('./helpers/fixtures');

// ============================================================================
// Module Loading Tests
// ============================================================================

test.describe('Challenges - Module Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('Challenges module is loaded and available on window', async ({ page }) => {
    const hasChallenges = await page.evaluate(() => typeof window.Challenges !== 'undefined');
    expect(hasChallenges).toBe(true);
  });

  test('Challenges module has create method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.create === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has getMyChallenges method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.getMyChallenges === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has getChallenge method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.getChallenge === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has getInvitations method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.getInvitations === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has getActiveChallenges method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.getActiveChallenges === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has acceptInvitation method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.acceptInvitation === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has declineInvitation method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.declineInvitation === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has inviteFriends method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.inviteFriends === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has inviteByEmail method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.inviteByEmail === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has showCreateModal method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.showCreateModal === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has showInviteFriendsModal method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.showInviteFriendsModal === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has closeCreateModal method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.closeCreateModal === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has closeInviteFriendsModal method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.closeInviteFriendsModal === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has renderList method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.renderList === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Challenges module has renderDetail method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Challenges?.renderDetail === 'function');
    expect(hasMethod).toBe(true);
  });
});

// ============================================================================
// Date Helper Tests
// ============================================================================

test.describe('Challenges - Date Helpers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('toLocalDateStr formats date correctly', async ({ page }) => {
    const result = await page.evaluate(() => {
      const date = new Date(2024, 0, 15); // Jan 15, 2024
      return window.Challenges.toLocalDateStr(date);
    });
    expect(result).toBe('2024-01-15');
  });

  test('toLocalDateStr pads single-digit months', async ({ page }) => {
    const result = await page.evaluate(() => {
      const date = new Date(2024, 4, 5); // May 5, 2024
      return window.Challenges.toLocalDateStr(date);
    });
    expect(result).toBe('2024-05-05');
  });

  test('toLocalDateStr pads single-digit days', async ({ page }) => {
    const result = await page.evaluate(() => {
      const date = new Date(2024, 11, 9); // Dec 9, 2024
      return window.Challenges.toLocalDateStr(date);
    });
    expect(result).toBe('2024-12-09');
  });

  test('parseLocalDate parses date correctly', async ({ page }) => {
    const result = await page.evaluate(() => {
      const date = window.Challenges.parseLocalDate('2024-01-15');
      return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
    });
    expect(result.year).toBe(2024);
    expect(result.month).toBe(0); // January = 0
    expect(result.day).toBe(15);
  });

  test('parseLocalDate handles leap year', async ({ page }) => {
    const result = await page.evaluate(() => {
      const date = window.Challenges.parseLocalDate('2024-02-29');
      return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
    });
    expect(result.year).toBe(2024);
    expect(result.month).toBe(1); // February = 1
    expect(result.day).toBe(29);
  });

  test('getDayNumber calculates correctly for challenge that started today', async ({ page }) => {
    const result = await page.evaluate(() => {
      const today = new Date();
      const startStr = window.Challenges.toLocalDateStr(today);
      return window.Challenges.getDayNumber(startStr);
    });
    expect(result).toBe(1); // Day 1 on start date
  });

  test('getDayNumber calculates correctly for challenge started 5 days ago', async ({ page }) => {
    const result = await page.evaluate(() => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 5);
      const startStr = window.Challenges.toLocalDateStr(startDate);
      return window.Challenges.getDayNumber(startStr);
    });
    expect(result).toBe(6); // Day 6 (5 days elapsed + current day)
  });

  test('getDayNumber returns at least 1 for future start dates', async ({ page }) => {
    const result = await page.evaluate(() => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const startStr = window.Challenges.toLocalDateStr(futureDate);
      return window.Challenges.getDayNumber(startStr);
    });
    expect(result).toBe(1); // Minimum is 1
  });

  test('getDaysRemaining calculates correctly for challenge ending today', async ({ page }) => {
    const result = await page.evaluate(() => {
      const today = new Date();
      const endStr = window.Challenges.toLocalDateStr(today);
      return window.Challenges.getDaysRemaining(endStr);
    });
    expect(result).toBe(0); // Ends today
  });

  test('getDaysRemaining calculates correctly for challenge ending in 5 days', async ({ page }) => {
    const result = await page.evaluate(() => {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 5);
      const endStr = window.Challenges.toLocalDateStr(endDate);
      return window.Challenges.getDaysRemaining(endStr);
    });
    expect(result).toBe(5);
  });

  test('getDaysRemaining returns 0 for past end dates', async ({ page }) => {
    const result = await page.evaluate(() => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);
      const endStr = window.Challenges.toLocalDateStr(pastDate);
      return window.Challenges.getDaysRemaining(endStr);
    });
    expect(result).toBe(0); // Minimum is 0
  });

  test('isActive returns true for active challenge', async ({ page }) => {
    const result = await page.evaluate(() => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 5);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 5);
      return window.Challenges.isActive(
        window.Challenges.toLocalDateStr(startDate),
        window.Challenges.toLocalDateStr(endDate)
      );
    });
    expect(result).toBe(true);
  });

  test('isActive returns false for future challenge', async ({ page }) => {
    const result = await page.evaluate(() => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 5);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 35);
      return window.Challenges.isActive(
        window.Challenges.toLocalDateStr(startDate),
        window.Challenges.toLocalDateStr(endDate)
      );
    });
    expect(result).toBe(false);
  });

  test('isActive returns false for completed challenge', async ({ page }) => {
    const result = await page.evaluate(() => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 35);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 5);
      return window.Challenges.isActive(
        window.Challenges.toLocalDateStr(startDate),
        window.Challenges.toLocalDateStr(endDate)
      );
    });
    expect(result).toBe(false);
  });
});

// ============================================================================
// UI Elements Tests - Unauthenticated State
// ============================================================================

test.describe('Challenges - UI Structure (Unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupUnauthenticatedPage(page);
  });

  test('Challenges page container exists in DOM', async ({ page }) => {
    const container = await page.locator('#challenges-container');
    await expect(container).toBeAttached();
  });

  test('Challenges page element exists', async ({ page }) => {
    const challengesPage = await page.locator('#page-challenges');
    await expect(challengesPage).toBeAttached();
  });

  test('Challenge detail page element exists', async ({ page }) => {
    const detailPage = await page.locator('#page-challenge-detail');
    await expect(detailPage).toBeAttached();
  });

  test('Challenge detail container exists', async ({ page }) => {
    const container = await page.locator('#challenge-detail-container');
    await expect(container).toBeAttached();
  });

  test('Challenges badge element exists on nav button', async ({ page }) => {
    const badge = await page.locator('#challenges-badge');
    await expect(badge).toBeAttached();
  });

  test('Challenges nav button exists with correct data-page attribute', async ({ page }) => {
    const navBtn = await page.locator('.nav-btn[data-page="challenges"]');
    await expect(navBtn).toBeAttached();
    await expect(navBtn).toHaveAttribute('data-page', 'challenges');
  });

  test('Challenges nav button has onclick handler for App.navigateTo', async ({ page }) => {
    const hasOnClick = await page.evaluate(() => {
      const btn = document.querySelector('.nav-btn[data-page="challenges"]');
      return btn?.hasAttribute('onclick');
    });
    expect(hasOnClick).toBe(true);
  });
});

// ============================================================================
// Create Challenge Modal Tests
// ============================================================================

test.describe('Challenges - Create Challenge Modal Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('showCreateModal function creates modal element', async ({ page }) => {
    // Mock dependencies to prevent actual API calls
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [
        { id: 'proto-1', name: 'Sleep Protocol', icon: '😴' }
      ];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    // Call showCreateModal
    await page.evaluate(() => window.Challenges.showCreateModal());

    // Verify modal is created
    const modal = await page.locator('#create-challenge-modal');
    await expect(modal).toBeVisible();
  });

  test('Create modal has protocol select field', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [
        { id: 'proto-1', name: 'Sleep Protocol', icon: '😴' },
        { id: 'proto-2', name: 'Morning Protocol', icon: '🌅' }
      ];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const protocolSelect = await page.locator('#challenge-protocol');
    await expect(protocolSelect).toBeVisible();
  });

  test('Create modal protocol select has required attribute', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [{ id: 'proto-1', name: 'Sleep', icon: '😴' }];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const protocolSelect = await page.locator('#challenge-protocol');
    await expect(protocolSelect).toHaveAttribute('required', '');
  });

  test('Create modal has mode selector section', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [{ id: 'proto-1', name: 'Sleep', icon: '😴' }];
      window.Protocols.renderModeSelector = (id, mode) => `<div id="mode-selector" data-mode="${mode}">Mode Selector</div>`;
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const modeSelector = await page.locator('#mode-selector');
    await expect(modeSelector).toBeAttached();
  });

  test('Create modal has form element', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [{ id: 'proto-1', name: 'Sleep', icon: '😴' }];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const form = await page.locator('#create-challenge-form');
    await expect(form).toBeVisible();
  });

  test('Create modal has Cancel button', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [{ id: 'proto-1', name: 'Sleep', icon: '😴' }];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const cancelButton = await page.locator('button:has-text("Cancel")');
    await expect(cancelButton).toBeVisible();
  });

  test('Create modal has Create/submit button', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [{ id: 'proto-1', name: 'Sleep', icon: '😴' }];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const createButton = await page.locator('#create-challenge-form button[type="submit"]');
    await expect(createButton).toBeVisible();
    await expect(createButton).toContainText('Create');
  });

  test('Create modal shows friends list when friends exist', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [{ id: 'proto-1', name: 'Sleep', icon: '😴' }];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [
        { id: 'friend-1', email: 'friend@example.com', displayName: 'Friend One' }
      ];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const friendCheckbox = await page.locator('input[name="friends"][value="friend-1"]');
    await expect(friendCheckbox).toBeAttached();
  });

  test('Create modal shows "No friends" message when no friends', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [{ id: 'proto-1', name: 'Sleep', icon: '😴' }];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const noFriendsText = await page.locator('text=No friends to invite');
    await expect(noFriendsText).toBeVisible();
  });

  test('closeCreateModal removes the modal', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [{ id: 'proto-1', name: 'Sleep', icon: '😴' }];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const modal = await page.locator('#create-challenge-modal');
    await expect(modal).toBeVisible();

    await page.evaluate(() => window.Challenges.closeCreateModal());

    await expect(modal).not.toBeAttached();
  });

  test('Cancel button closes the modal', async ({ page }) => {
    await page.evaluate(() => {
      window.Protocols = window.Protocols || {};
      window.Protocols.getAll = async () => [{ id: 'proto-1', name: 'Sleep', icon: '😴' }];
      window.Protocols.renderModeSelector = () => '<div id="mode-selector">Mode</div>';
      window.Protocols._selectedMode = 'pro';
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showCreateModal());

    const modal = await page.locator('#create-challenge-modal');
    await expect(modal).toBeVisible();

    await page.click('button:has-text("Cancel")');

    await expect(modal).not.toBeAttached();
  });
});

// ============================================================================
// Invite Friends Modal Tests
// ============================================================================

test.describe('Challenges - Invite Friends Modal Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('showInviteFriendsModal function creates modal element', async ({ page }) => {
    // Mock dependencies
    await page.evaluate(() => {
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        participants: []
      });
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showInviteFriendsModal('challenge-1'));

    const modal = await page.locator('#invite-friends-modal');
    await expect(modal).toBeVisible();
  });

  test('Invite modal has email input field', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        participants: []
      });
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showInviteFriendsModal('challenge-1'));

    const emailInput = await page.locator('#invite-email-input');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
  });

  test('Invite modal has Invite button for email', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        participants: []
      });
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showInviteFriendsModal('challenge-1'));

    const inviteBtn = await page.locator('#invite-email-btn');
    await expect(inviteBtn).toBeVisible();
    await expect(inviteBtn).toContainText('Invite');
  });

  test('Invite modal has status element for feedback', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        participants: []
      });
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showInviteFriendsModal('challenge-1'));

    const statusEl = await page.locator('#invite-email-status');
    await expect(statusEl).toBeAttached();
  });

  test('Invite modal has Close button', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        participants: []
      });
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showInviteFriendsModal('challenge-1'));

    const closeButton = await page.locator('button:has-text("Close")');
    await expect(closeButton).toBeVisible();
  });

  test('Invite modal shows available friends when friends exist', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        participants: [{ user: { id: 'existing-user' } }]
      });
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [
        { id: 'available-friend', email: 'available@example.com', displayName: 'Available Friend' }
      ];
    });

    await page.evaluate(() => window.Challenges.showInviteFriendsModal('challenge-1'));

    const friendForm = await page.locator('#invite-friends-form');
    await expect(friendForm).toBeVisible();
  });

  test('Invite modal filters out friends already in challenge', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        participants: [{ user: { id: 'already-in-challenge' } }]
      });
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [
        { id: 'already-in-challenge', email: 'existing@example.com', displayName: 'Existing' },
        { id: 'new-friend', email: 'new@example.com', displayName: 'New Friend' }
      ];
    });

    await page.evaluate(() => window.Challenges.showInviteFriendsModal('challenge-1'));

    // Should only show new-friend, not already-in-challenge
    const existingCheckbox = await page.locator('input[value="already-in-challenge"]');
    const newCheckbox = await page.locator('input[value="new-friend"]');

    await expect(existingCheckbox).not.toBeAttached();
    await expect(newCheckbox).toBeAttached();
  });

  test('closeInviteFriendsModal removes the modal', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        participants: []
      });
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showInviteFriendsModal('challenge-1'));

    const modal = await page.locator('#invite-friends-modal');
    await expect(modal).toBeVisible();

    await page.evaluate(() => window.Challenges.closeInviteFriendsModal());

    await expect(modal).not.toBeAttached();
  });

  test('Close button closes the invite modal', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        participants: []
      });
      window.Friends = window.Friends || {};
      window.Friends.getFriends = async () => [];
    });

    await page.evaluate(() => window.Challenges.showInviteFriendsModal('challenge-1'));

    const modal = await page.locator('#invite-friends-modal');
    await expect(modal).toBeVisible();

    await page.click('button:has-text("Close")');

    await expect(modal).not.toBeAttached();
  });
});

// ============================================================================
// Challenges List Rendering Tests
// These tests verify that renderList correctly generates HTML content.
// Elements render into #challenges-container which is inside #page-challenges (hidden by default).
// We use toBeAttached() to verify elements are in the DOM (visibility requires showing the page).
// ============================================================================

test.describe('Challenges - List Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('renderList creates Create Challenge button', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getInvitations = async () => [];
      window.Challenges.getActiveChallenges = async () => [];
    });

    await page.evaluate(() => window.Challenges.renderList());

    const createButton = await page.locator('#challenges-container button:has-text("Create New Challenge")');
    await expect(createButton).toBeAttached();
  });

  test('renderList shows empty state when no challenges', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getInvitations = async () => [];
      window.Challenges.getActiveChallenges = async () => [];
    });

    await page.evaluate(() => window.Challenges.renderList());

    const emptyText = await page.locator('#challenges-container:has-text("No active challenges")');
    await expect(emptyText).toBeAttached();
  });

  test('renderList shows invitations section when invitations exist', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getInvitations = async () => [{
        participantId: 'part-1',
        name: 'Invited Challenge',
        protocol: { name: 'Test', icon: '🧪' },
        creator: { email: 'creator@example.com' }
      }];
      window.Challenges.getActiveChallenges = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.renderModeBadge = () => '<span>Mode</span>';
    });

    await page.evaluate(() => window.Challenges.renderList());

    const invitationsHeader = await page.locator('#challenges-container h3:has-text("Challenge Invitations")');
    await expect(invitationsHeader).toBeAttached();
  });

  test('renderList shows invitation count badge', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getInvitations = async () => [
        { participantId: 'p1', name: 'Challenge 1', protocol: { name: 'Test', icon: '🧪' }, creator: { email: 'a@b.com' } },
        { participantId: 'p2', name: 'Challenge 2', protocol: { name: 'Test', icon: '🧪' }, creator: { email: 'a@b.com' } }
      ];
      window.Challenges.getActiveChallenges = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.renderModeBadge = () => '';
    });

    await page.evaluate(() => window.Challenges.renderList());

    const countText = await page.locator('#challenges-container h3:has-text("Challenge Invitations (2)")');
    await expect(countText).toBeAttached();
  });

  test('renderList shows Join button for invitations', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getInvitations = async () => [{
        participantId: 'part-1',
        name: 'Invited Challenge',
        protocol: { name: 'Test', icon: '🧪' },
        creator: { email: 'creator@example.com' }
      }];
      window.Challenges.getActiveChallenges = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.renderModeBadge = () => '';
    });

    await page.evaluate(() => window.Challenges.renderList());

    const joinButton = await page.locator('#challenges-container button:has-text("Join")');
    await expect(joinButton).toBeAttached();
  });

  test('renderList shows Decline button for invitations', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getInvitations = async () => [{
        participantId: 'part-1',
        name: 'Invited Challenge',
        protocol: { name: 'Test', icon: '🧪' },
        creator: { email: 'creator@example.com' }
      }];
      window.Challenges.getActiveChallenges = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.renderModeBadge = () => '';
    });

    await page.evaluate(() => window.Challenges.renderList());

    const declineButton = await page.locator('#challenges-container button:has-text("Decline")');
    await expect(declineButton).toBeAttached();
  });

  test('renderList shows active challenges section', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getInvitations = async () => [];
      window.Challenges.getActiveChallenges = async () => [{
        id: 'challenge-1',
        name: 'Active Challenge',
        start_date: new Date().toISOString().split('T')[0],
        daysRemaining: 25,
        protocol: { name: 'Sleep', icon: '😴' }
      }];
      window.Protocols = window.Protocols || {};
      window.Protocols.renderModeBadge = () => '';
    });

    await page.evaluate(() => window.Challenges.renderList());

    const activeChallengesHeader = await page.locator('#challenges-container h3:has-text("Active Challenges (1)")');
    await expect(activeChallengesHeader).toBeAttached();
  });

  test('renderList shows days remaining for active challenges', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getInvitations = async () => [];
      window.Challenges.getActiveChallenges = async () => [{
        id: 'challenge-1',
        name: 'Active Challenge',
        start_date: new Date().toISOString().split('T')[0],
        daysRemaining: 25,
        protocol: { name: 'Sleep', icon: '😴' }
      }];
      window.Protocols = window.Protocols || {};
      window.Protocols.renderModeBadge = () => '';
    });

    await page.evaluate(() => window.Challenges.renderList());

    const daysText = await page.locator('#challenges-container:has-text("25 days left")');
    await expect(daysText).toBeAttached();
  });

  test('renderList shows error state on fetch failure', async ({ page }) => {
    await page.evaluate(() => {
      window.Challenges.getInvitations = async () => { throw new Error('Network error'); };
      window.Challenges.getActiveChallenges = async () => [];
    });

    await page.evaluate(() => window.Challenges.renderList());

    const errorText = await page.locator('#challenges-container:has-text("Failed to load challenges")');
    await expect(errorText).toBeAttached();
  });
});

// ============================================================================
// Challenge Detail Rendering Tests
// These tests verify that renderDetail correctly generates HTML content.
// Elements render into #challenge-detail-container which is inside #page-challenge-detail (hidden by default).
// We use toBeAttached() to verify elements are in the DOM (visibility requires showing the page).
// ============================================================================

test.describe('Challenges - Detail Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('renderDetail displays challenge name', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Better Sleep Challenge',
        mode: 'pro',
        dayNumber: 10,
        daysRemaining: 20,
        protocol: { name: 'Sleep', icon: '😴', habits: [] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => [];
      window.Challenges.getParticipantProgress = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [];
      window.Protocols.renderModeBadge = () => '<span class="badge">PRO</span>';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const challengeName = await page.locator('#challenge-detail-container h2:has-text("Better Sleep Challenge")');
    await expect(challengeName).toBeAttached();
  });

  test('renderDetail displays day number and days remaining', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test Challenge',
        mode: 'pro',
        dayNumber: 15,
        daysRemaining: 15,
        protocol: { name: 'Sleep', icon: '😴', habits: [] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => [];
      window.Challenges.getParticipantProgress = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [];
      window.Protocols.renderModeBadge = () => '';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const dayNumber = await page.locator('#challenge-detail-container:has-text("Day 15 of 30")');
    const daysRemaining = await page.locator('#challenge-detail-container:has-text("15 days left")');
    await expect(dayNumber).toBeAttached();
    await expect(daysRemaining).toBeAttached();
  });

  test('renderDetail displays Back button', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test',
        mode: 'pro',
        dayNumber: 1,
        daysRemaining: 30,
        protocol: { name: 'Sleep', icon: '😴', habits: [] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => [];
      window.Challenges.getParticipantProgress = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [];
      window.Protocols.renderModeBadge = () => '';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const backButton = await page.locator('#challenge-detail-container button:has-text("Back")');
    await expect(backButton).toBeAttached();
  });

  test('renderDetail displays habits section', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test',
        mode: 'pro',
        dayNumber: 1,
        daysRemaining: 30,
        protocol: { name: 'Sleep', icon: '😴', habits: [{ id: 'h1', title: 'No caffeine after 2pm' }] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => [];
      window.Challenges.getParticipantProgress = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [{ id: 'h1', title: 'No caffeine after 2pm' }];
      window.Protocols.renderModeBadge = () => '';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const habitsHeader = await page.locator("#challenge-detail-container h3:has-text(\"Today's Habits\")");
    await expect(habitsHeader).toBeAttached();
  });

  test('renderDetail displays habit checkboxes', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test',
        mode: 'pro',
        dayNumber: 1,
        daysRemaining: 30,
        protocol: { name: 'Sleep', icon: '😴', habits: [] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => [];
      window.Challenges.getParticipantProgress = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [
        { id: 'h1', title: 'Habit 1' },
        { id: 'h2', title: 'Habit 2' }
      ];
      window.Protocols.renderModeBadge = () => '';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const checkboxes = await page.locator('input[type="checkbox"]');
    expect(await checkboxes.count()).toBe(2);
  });

  test('renderDetail marks completed habits as checked', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test',
        mode: 'pro',
        dayNumber: 1,
        daysRemaining: 30,
        protocol: { name: 'Sleep', icon: '😴', habits: [] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => ['h1']; // h1 is completed
      window.Challenges.getParticipantProgress = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [
        { id: 'h1', title: 'Habit 1' },
        { id: 'h2', title: 'Habit 2' }
      ];
      window.Protocols.renderModeBadge = () => '';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    // First checkbox should be checked, second should not be
    const checkedCount = await page.evaluate(() =>
      document.querySelectorAll('input[type="checkbox"]:checked').length
    );
    expect(checkedCount).toBe(1);
  });

  test('renderDetail displays participant progress section', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test',
        mode: 'pro',
        dayNumber: 1,
        daysRemaining: 30,
        protocol: { name: 'Sleep', icon: '😴', habits: [] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => [];
      window.Challenges.getParticipantProgress = async () => [
        { user: { display_name: 'User 1' }, percentage: 80 },
        { user: { display_name: 'User 2' }, percentage: 60 }
      ];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [];
      window.Protocols.renderModeBadge = () => '';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const progressHeader = await page.locator('#challenge-detail-container h3:has-text("Habit Progress")');
    await expect(progressHeader).toBeAttached();
  });

  test('renderDetail displays participant names and percentages', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test',
        mode: 'pro',
        dayNumber: 1,
        daysRemaining: 30,
        protocol: { name: 'Sleep', icon: '😴', habits: [] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => [];
      window.Challenges.getParticipantProgress = async () => [
        { user: { display_name: 'Alice' }, percentage: 75 }
      ];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [];
      window.Protocols.renderModeBadge = () => '';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const participantName = await page.locator('#challenge-detail-container:has-text("Alice")');
    const percentage = await page.locator('#challenge-detail-container:has-text("75%")');
    await expect(participantName).toBeAttached();
    await expect(percentage).toBeAttached();
  });

  test('renderDetail displays Invite Friends button', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test',
        mode: 'pro',
        dayNumber: 1,
        daysRemaining: 30,
        protocol: { name: 'Sleep', icon: '😴', habits: [] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => [];
      window.Challenges.getParticipantProgress = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [];
      window.Protocols.renderModeBadge = () => '';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const inviteButton = await page.locator('#challenge-detail-container button:has-text("Invite Friends")');
    await expect(inviteButton).toBeAttached();
  });

  test('renderDetail displays Sleep Performance section', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => ({
        id: 'challenge-1',
        name: 'Test',
        mode: 'pro',
        dayNumber: 1,
        daysRemaining: 30,
        protocol: { name: 'Sleep', icon: '😴', habits: [] },
        participants: []
      });
      window.Challenges.getHabitCompletions = async () => [];
      window.Challenges.getParticipantProgress = async () => [];
      window.Protocols = window.Protocols || {};
      window.Protocols.getHabitsForMode = () => [];
      window.Protocols.renderModeBadge = () => '';
      window.Comparison = window.Comparison || {};
      window.Comparison.renderForChallenge = () => {};
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const sleepHeader = await page.locator('#challenge-detail-container h3:has-text("Sleep Performance")');
    await expect(sleepHeader).toBeAttached();
  });

  test('renderDetail shows error state on fetch failure', async ({ page }) => {
    await page.evaluate(() => {
      window.SupabaseClient = window.SupabaseClient || {};
      window.SupabaseClient.getCurrentUser = async () => ({ id: 'user-1' });
      window.Challenges.getChallenge = async () => { throw new Error('Challenge not found'); };
    });

    await page.evaluate(() => window.Challenges.renderDetail('challenge-1'));

    const errorText = await page.locator('#challenge-detail-container:has-text("Failed to load challenge")');
    await expect(errorText).toBeAttached();
  });
});

// ============================================================================
// Navigation Integration Tests
// App is defined as a const in inline script - not on window, but accessible as global
// ============================================================================

test.describe('Challenges - Navigation Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('App.navigateTo highlights challenges nav button', async ({ page }) => {
    // Mock dependencies to prevent API calls
    await page.evaluate(() => {
      Challenges.renderList = async () => {};
      App.checkNotifications = async () => {};
    });

    await page.evaluate(() => App.navigateTo('challenges'));

    const navBtn = await page.locator('.nav-btn[data-page="challenges"]');
    const hasActiveClass = await navBtn.evaluate(el => el.classList.contains('text-oura-accent'));
    expect(hasActiveClass).toBe(true);
  });

  test('App.navigateTo shows challenges page', async ({ page }) => {
    await page.evaluate(() => {
      Challenges.renderList = async () => {};
      App.checkNotifications = async () => {};
    });

    await page.evaluate(() => App.navigateTo('challenges'));

    const challengesPage = await page.locator('#page-challenges');
    await expect(challengesPage).not.toHaveClass(/hidden/);
  });

  test('App.navigateTo calls Challenges.renderList for challenges page', async ({ page }) => {
    await page.evaluate(() => {
      Challenges.renderList = async () => {
        window.__renderListCalled = true;
      };
      App.checkNotifications = async () => {};
    });

    await page.evaluate(() => App.navigateTo('challenges'));

    const called = await page.evaluate(() => window.__renderListCalled);
    expect(called).toBe(true);
  });

  test('App.navigateTo shows challenge-detail page with detailId', async ({ page }) => {
    await page.evaluate(() => {
      Challenges.renderDetail = async () => {};
    });

    await page.evaluate(() => App.navigateTo('challenge-detail', 'test-id'));

    const detailPage = await page.locator('#page-challenge-detail');
    await expect(detailPage).not.toHaveClass(/hidden/);
  });

  test('App.navigateTo stores challengeId in challenge-detail container', async ({ page }) => {
    await page.evaluate(() => {
      Challenges.renderDetail = async () => {};
    });

    await page.evaluate(() => App.navigateTo('challenge-detail', 'my-challenge-id'));

    const challengeId = await page.evaluate(() =>
      document.getElementById('challenge-detail-container')?.dataset.challengeId
    );
    expect(challengeId).toBe('my-challenge-id');
  });

  test('challenge-detail navigation highlights challenges nav button', async ({ page }) => {
    await page.evaluate(() => {
      Challenges.renderDetail = async () => {};
    });

    await page.evaluate(() => App.navigateTo('challenge-detail', 'test-id'));

    // Detail pages should highlight parent nav item (challenges)
    const navBtn = await page.locator('.nav-btn[data-page="challenges"]');
    const hasActiveClass = await navBtn.evaluate(el => el.classList.contains('text-oura-accent'));
    expect(hasActiveClass).toBe(true);
  });
});

// ============================================================================
// Badge/Notification Tests
// App is defined as a const in inline script - not on window, but accessible as global
// ============================================================================

test.describe('Challenges - Badge Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Badge is hidden initially', async ({ page }) => {
    const badge = await page.locator('#challenges-badge');
    await expect(badge).toHaveClass(/hidden/);
  });

  test('App.checkNotifications shows badge when invitations exist', async ({ page }) => {
    await page.evaluate(() => {
      Challenges.getInvitations = async () => [{ id: 'inv-1' }];
      Friends.getPendingRequests = async () => [];
    });

    await page.evaluate(() => App.checkNotifications());

    const badge = await page.locator('#challenges-badge');
    await expect(badge).not.toHaveClass(/hidden/);
  });

  test('App.checkNotifications hides badge when no invitations', async ({ page }) => {
    // First show the badge
    await page.evaluate(() => {
      document.getElementById('challenges-badge').classList.remove('hidden');
    });

    await page.evaluate(() => {
      Challenges.getInvitations = async () => [];
      Friends.getPendingRequests = async () => [];
    });

    await page.evaluate(() => App.checkNotifications());

    const badge = await page.locator('#challenges-badge');
    await expect(badge).toHaveClass(/hidden/);
  });

  test('Multiple invitations still shows badge (not count)', async ({ page }) => {
    await page.evaluate(() => {
      Challenges.getInvitations = async () => [
        { id: 'inv-1' },
        { id: 'inv-2' },
        { id: 'inv-3' }
      ];
      Friends.getPendingRequests = async () => [];
    });

    await page.evaluate(() => App.checkNotifications());

    const badge = await page.locator('#challenges-badge');
    await expect(badge).not.toHaveClass(/hidden/);
    // Badge is just a dot indicator, not a count
  });
});
