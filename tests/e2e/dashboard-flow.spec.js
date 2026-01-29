// @ts-check
/**
 * Dashboard E2E Tests
 * Tests for dashboard sleep data display, comparisons, and navigation
 */

const { test, expect } = require('@playwright/test');
const { setupUnauthenticatedPage } = require('./helpers/auth');

test.describe('Dashboard - Module Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Dashboard module is loaded and available', async ({ page }) => {
    const hasDashboard = await page.evaluate(() => typeof window.Dashboard !== 'undefined');
    expect(hasDashboard).toBe(true);
  });

  test('Dashboard module has render method', async ({ page }) => {
    const hasRender = await page.evaluate(() => typeof window.Dashboard.render === 'function');
    expect(hasRender).toBe(true);
  });

  test('Dashboard module has getRecentSleepData method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Dashboard.getRecentSleepData === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Dashboard module has calcAvgHR method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Dashboard.calcAvgHR === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Dashboard module has calcAvgSleepScore method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Dashboard.calcAvgSleepScore === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Dashboard module has showMetricDetail method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Dashboard.showMetricDetail === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Dashboard module has closeMetricDetail method', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Dashboard.closeMetricDetail === 'function');
    expect(hasMethod).toBe(true);
  });
});

test.describe('Dashboard - Sleep Metric Calculations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('calcAvgHR handles empty data', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.calcAvgHR([]));
    expect(result).toBeNull();
  });

  test('calcAvgHR computes correct average', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { avg_hr: 60 },
        { avg_hr: 62 },
        { avg_hr: 64 }
      ];
      return window.Dashboard.calcAvgHR(data);
    });
    expect(result).toBe(62); // (60+62+64)/3 = 62
  });

  test('calcAvgHR filters out null HR values', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { avg_hr: 60 },
        { avg_hr: null },
        { avg_hr: 64 }
      ];
      return window.Dashboard.calcAvgHR(data);
    });
    expect(result).toBe(62); // (60+64)/2 = 62
  });

  test('calcAvgPreSleepHR handles empty data', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.calcAvgPreSleepHR([]));
    expect(result).toBeNull();
  });

  test('calcAvgPreSleepHR computes correct average', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { pre_sleep_hr: 55 },
        { pre_sleep_hr: 57 },
        { pre_sleep_hr: 58 }
      ];
      return window.Dashboard.calcAvgPreSleepHR(data);
    });
    expect(result).toBe(57); // (55+57+58)/3 = 56.67 -> 57
  });

  test('calcAvgDeepSleep handles empty data', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.calcAvgDeepSleep([]));
    expect(result).toBeNull();
  });

  test('calcAvgDeepSleep computes correct average', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { deep_sleep_minutes: 90 },
        { deep_sleep_minutes: 85 },
        { deep_sleep_minutes: 95 }
      ];
      return window.Dashboard.calcAvgDeepSleep(data);
    });
    expect(result).toBe(90); // (90+85+95)/3 = 90
  });

  test('calcAvgSleepScore handles empty data', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.calcAvgSleepScore([]));
    expect(result).toBeNull();
  });

  test('calcAvgSleepScore computes correct average', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { sleep_score: 80 },
        { sleep_score: 85 },
        { sleep_score: 82 }
      ];
      return window.Dashboard.calcAvgSleepScore(data);
    });
    expect(result).toBe(82); // (80+85+82)/3 = 82.33 -> 82
  });

  test('getMinHR returns minimum heart rate', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { avg_hr: 62 },
        { avg_hr: 58 },
        { avg_hr: 65 }
      ];
      return window.Dashboard.getMinHR(data);
    });
    expect(result).toBe(58);
  });

  test('getMaxHR returns maximum heart rate', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { avg_hr: 62 },
        { avg_hr: 58 },
        { avg_hr: 65 }
      ];
      return window.Dashboard.getMaxHR(data);
    });
    expect(result).toBe(65);
  });

  test('getMinHR returns placeholder for empty data', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.getMinHR([]));
    expect(result).toBe('--');
  });

  test('getMaxHR returns placeholder for empty data', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.getMaxHR([]));
    expect(result).toBe('--');
  });
});

test.describe('Dashboard - Motivational Messages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('getMotivationalMessage handles no HR and no challenge', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.getMotivationalMessage(null, null));
    expect(result).toContain('Connect your Oura ring');
  });

  test('getMotivationalMessage handles low HR with no challenge', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.getMotivationalMessage(55, null));
    expect(result).toContain('55');
    expect(result).toContain('excellent');
  });

  test('getMotivationalMessage handles moderate HR with no challenge', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.getMotivationalMessage(65, null));
    expect(result).toContain('65');
    expect(result).toContain('solid');
  });

  test('getMotivationalMessage handles high HR with no challenge', async ({ page }) => {
    const result = await page.evaluate(() => window.Dashboard.getMotivationalMessage(75, null));
    expect(result).toContain('75');
  });

  test('getMotivationalMessage includes challenge context when active', async ({ page }) => {
    const result = await page.evaluate(() => {
      const mockChallenge = {
        name: 'Test Challenge',
        start_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      };
      return window.Dashboard.getMotivationalMessage(60, mockChallenge);
    });
    expect(result).toContain('Test Challenge');
  });
});

test.describe('Dashboard - Comparison Module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Comparison module is available', async ({ page }) => {
    const hasComparison = await page.evaluate(() => typeof window.Comparison !== 'undefined');
    expect(hasComparison).toBe(true);
  });

  test('Comparison.calcMedian handles odd array', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.calcMedian([1, 3, 5, 7, 9]));
    expect(result).toBe(5);
  });

  test('Comparison.calcMedian handles even array', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.calcMedian([1, 3, 5, 7]));
    expect(result).toBe(4); // (3+5)/2
  });

  test('Comparison.calcMedian handles single element', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.calcMedian([42]));
    expect(result).toBe(42);
  });

  test('Comparison.calcMedian handles empty array', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.calcMedian([]));
    expect(result).toBeNull();
  });

  test('Comparison.calcAverages handles empty data', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.calcAverages([], 30));
    expect(result.hr).toBeNull();
    expect(result.score).toBeNull();
    expect(result.hours).toBeNull();
    expect(result.dataPoints).toBe(0);
  });

  test('Comparison.calcAverages computes correct values', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { pre_sleep_hr: 60, sleep_score: 80, total_sleep_minutes: 420 },
        { pre_sleep_hr: 62, sleep_score: 82, total_sleep_minutes: 440 }
      ];
      return window.Comparison.calcAverages(data);
    });

    expect(result.hr).toBe(61); // (60+62)/2
    expect(result.score).toBe(81); // (80+82)/2
    expect(result.dataPoints).toBe(2);
  });

  test('Comparison.calcAverages handles missing fields', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { pre_sleep_hr: 60 },
        { sleep_score: 80 },
        { total_sleep_minutes: 420 }
      ];
      return window.Comparison.calcAverages(data);
    });

    expect(result.hr).toBe(60);
    expect(result.score).toBe(80);
    expect(result.dataPoints).toBe(3);
  });
});

test.describe('Dashboard - Change Indicators', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('formatChange shows green down arrow for HR improvement (lower is better)', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(65, 60, true));

    // HR improvement: baseline 65 -> current 60 (lower is better)
    expect(result).toContain('text-green-400');
    expect(result).toContain('↓');
    expect(result).toContain('-5');
  });

  test('formatChange shows red up arrow for HR worsening', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(60, 65, true));

    // HR worsening: baseline 60 -> current 65 (higher is worse)
    expect(result).toContain('text-red-400');
    expect(result).toContain('↑');
    expect(result).toContain('+5');
  });

  test('formatChange shows green up arrow for score improvement (higher is better)', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(75, 85, false));

    // Score improvement: baseline 75 -> current 85 (higher is better)
    expect(result).toContain('text-green-400');
    expect(result).toContain('↑');
    expect(result).toContain('+10');
  });

  test('formatChange shows red down arrow for score worsening', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(85, 75, false));

    // Score worsening: baseline 85 -> current 75 (lower is worse)
    expect(result).toContain('text-red-400');
    expect(result).toContain('↓');
    expect(result).toContain('-10');
  });

  test('formatChange shows neutral indicator for no change', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(75, 75, false));

    // No change
    expect(result).toContain('—');
    expect(result).toContain('text-oura-muted');
  });

  test('formatChange handles null baseline', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(null, 75, false));
    expect(result).toBe('');
  });

  test('formatChange handles null current', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(75, null, false));
    expect(result).toBe('');
  });

  test('formatChange handles decimal values', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(7.0, 7.5, false));
    expect(result).toContain('+0.5');
  });
});

test.describe('Dashboard - UI Elements (Unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupUnauthenticatedPage(page);
  });

  test('unauthenticated users see auth section', async ({ page }) => {
    const authSection = page.locator('#auth-section');
    await expect(authSection).toBeVisible();
  });

  test('app content is hidden for unauthenticated users', async ({ page }) => {
    const appContent = page.locator('#app-content');
    await expect(appContent).toHaveClass(/hidden/);
  });

  test('dashboard container exists in DOM', async ({ page }) => {
    const dashboardContainer = page.locator('#dashboard-container');
    await expect(dashboardContainer).toBeAttached();
  });

  test('page-dashboard exists in DOM', async ({ page }) => {
    const dashboardPage = page.locator('#page-dashboard');
    await expect(dashboardPage).toBeAttached();
  });
});

test.describe('Dashboard - Navigation Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('bottom navigation has 4 buttons', async ({ page }) => {
    const navButtons = page.locator('.nav-btn');
    await expect(navButtons).toHaveCount(4);
  });

  test('dashboard navigation button exists', async ({ page }) => {
    const dashboardBtn = page.locator('[data-page="dashboard"]');
    await expect(dashboardBtn).toBeAttached();
  });

  test('protocols navigation button exists', async ({ page }) => {
    const protocolsBtn = page.locator('[data-page="protocols"]');
    await expect(protocolsBtn).toBeAttached();
  });

  test('challenges navigation button exists', async ({ page }) => {
    const challengesBtn = page.locator('[data-page="challenges"]');
    await expect(challengesBtn).toBeAttached();
  });

  test('friends navigation button exists', async ({ page }) => {
    const friendsBtn = page.locator('[data-page="friends"]');
    await expect(friendsBtn).toBeAttached();
  });

  test('navigation badges are initially hidden', async ({ page }) => {
    const challengesBadge = page.locator('#challenges-badge');
    const friendsBadge = page.locator('#friends-badge');

    // Badges should have hidden class
    await expect(challengesBadge).toHaveClass(/hidden/);
    await expect(friendsBadge).toHaveClass(/hidden/);
  });
});

test.describe('Dashboard - Navigation Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('navigation buttons have onclick handlers', async ({ page }) => {
    // Verify navigation buttons have onclick attribute
    const dashboardBtn = page.locator('[data-page="dashboard"]');
    const onclick = await dashboardBtn.getAttribute('onclick');
    expect(onclick).toContain('navigateTo');
  });

  test('all nav buttons have data-page attribute', async ({ page }) => {
    const navButtons = page.locator('.nav-btn[data-page]');
    await expect(navButtons).toHaveCount(4);

    // Verify each has unique page name
    const pages = await navButtons.evaluateAll(btns =>
      btns.map(btn => btn.getAttribute('data-page'))
    );
    expect(pages).toContain('dashboard');
    expect(pages).toContain('protocols');
    expect(pages).toContain('challenges');
    expect(pages).toContain('friends');
  });

  test('page containers have correct IDs', async ({ page }) => {
    // Verify all page containers exist with expected IDs
    const pageIds = ['page-dashboard', 'page-protocols', 'page-challenges', 'page-friends'];

    for (const id of pageIds) {
      const pageEl = page.locator(`#${id}`);
      await expect(pageEl).toBeAttached();
    }
  });
});

test.describe('Dashboard - SleepSync Module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('SleepSync module is available', async ({ page }) => {
    const hasSleepSync = await page.evaluate(() => typeof window.SleepSync !== 'undefined');
    expect(hasSleepSync).toBe(true);
  });

  test('SleepSync.syncNow function exists', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.SleepSync.syncNow === 'function');
    expect(hasMethod).toBe(true);
  });
});

test.describe('Dashboard - Page Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('page-dashboard has header structure', async ({ page }) => {
    const dashboardH2 = page.locator('#page-dashboard h2');
    await expect(dashboardH2).toHaveText('Dashboard');
  });

  test('page-dashboard has description', async ({ page }) => {
    const description = page.locator('#page-dashboard .text-oura-muted.text-sm').first();
    await expect(description).toHaveText('Your sleep performance at a glance');
  });

  test('all main pages exist in DOM', async ({ page }) => {
    const pages = ['dashboard', 'protocols', 'challenges', 'friends'];

    for (const pageName of pages) {
      const pageEl = page.locator(`#page-${pageName}`);
      await expect(pageEl).toBeAttached();
    }
  });

  test('header contains app title', async ({ page }) => {
    const headerTitle = page.locator('.app-header h1');
    await expect(headerTitle).toHaveText('Protocol');
  });
});

test.describe('Dashboard - Chart Module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Chart.js library is loaded', async ({ page }) => {
    const hasChart = await page.evaluate(() => typeof window.Chart !== 'undefined');
    expect(hasChart).toBe(true);
  });

  test('Dashboard.renderSparkline function exists', async ({ page }) => {
    const hasMethod = await page.evaluate(() => typeof window.Dashboard.renderSparkline === 'function');
    expect(hasMethod).toBe(true);
  });

  test('Comparison has chart colors defined', async ({ page }) => {
    const hasColors = await page.evaluate(() => Array.isArray(window.Comparison.colors) && window.Comparison.colors.length > 0);
    expect(hasColors).toBe(true);
  });
});

test.describe('Dashboard - Comparison Baseline Logic', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('calcAverages uses median fill for missing days', async ({ page }) => {
    const result = await page.evaluate(() => {
      // 5 data points but expecting 10 days
      const data = [
        { pre_sleep_hr: 60, sleep_score: 80, total_sleep_minutes: 420 },
        { pre_sleep_hr: 62, sleep_score: 82, total_sleep_minutes: 430 },
        { pre_sleep_hr: 58, sleep_score: 78, total_sleep_minutes: 410 },
        { pre_sleep_hr: 64, sleep_score: 84, total_sleep_minutes: 440 },
        { pre_sleep_hr: 60, sleep_score: 80, total_sleep_minutes: 420 }
      ];
      return window.Comparison.calcAverages(data, 10);
    });

    // With 5 data points over 10 expected days, median should be used for fill
    // HR: [58, 60, 60, 62, 64] median = 60
    // Sum = 60+62+58+64+60 = 304, fill 5 * 60 = 300, total = 604
    // 604/10 = 60.4 -> 60
    expect(result.hr).toBe(60);
    expect(result.dataPoints).toBe(5);
  });

  test('calcAverages without expected days uses simple average', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { pre_sleep_hr: 60, sleep_score: 80, total_sleep_minutes: 420 },
        { pre_sleep_hr: 62, sleep_score: 82, total_sleep_minutes: 440 }
      ];
      return window.Comparison.calcAverages(data); // No expectedDays
    });

    expect(result.hr).toBe(61); // (60+62)/2
    expect(result.score).toBe(81); // (80+82)/2
  });

  test('Comparison.formatDate marks challenge start date', async ({ page }) => {
    const result = await page.evaluate(() => {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      return window.Comparison.formatDate(dateStr, dateStr);
    });

    // Should have arrow marker for start date
    expect(result).toContain('▸');
  });

  test('Comparison.formatDate without start marker', async ({ page }) => {
    const result = await page.evaluate(() => {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const otherDate = '2024-01-01';
      return window.Comparison.formatDate(dateStr, otherDate);
    });

    // Should not have arrow marker
    expect(result).not.toContain('▸');
  });
});
