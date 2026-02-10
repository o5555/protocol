// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Dashboard Modules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Dashboard module is loaded', async ({ page }) => {
    const hasDashboard = await page.evaluate(() => typeof window.Dashboard !== 'undefined');
    expect(hasDashboard).toBe(true);
  });

  test('SleepSync module is loaded', async ({ page }) => {
    const hasSleepSync = await page.evaluate(() => typeof window.SleepSync !== 'undefined');
    expect(hasSleepSync).toBe(true);
  });

  test('Comparison module has calcAverages', async ({ page }) => {
    const has = await page.evaluate(() => typeof window.Comparison?.calcAverages === 'function');
    expect(has).toBe(true);
  });

  test('Comparison module has calcMedian', async ({ page }) => {
    const has = await page.evaluate(() => typeof window.Comparison?.calcMedian === 'function');
    expect(has).toBe(true);
  });

  test('Comparison module has formatChange', async ({ page }) => {
    const has = await page.evaluate(() => typeof window.Comparison?.formatChange === 'function');
    expect(has).toBe(true);
  });
});

test.describe('Comparison Calculations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('calcAverages handles empty data', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.calcAverages([], 30));
    expect(result.hr).toBeNull();
    expect(result.score).toBeNull();
    expect(result.hours).toBeNull();
  });

  test('calcAverages computes with expected days', async ({ page }) => {
    const result = await page.evaluate(() => {
      const data = [
        { pre_sleep_hr: 60, sleep_score: 80, total_sleep_minutes: 420 },
        { pre_sleep_hr: 62, sleep_score: 82, total_sleep_minutes: 440 }
      ];
      return window.Comparison.calcAverages(data, 30);
    });
    expect(result.hr).toBeDefined();
    expect(result.score).toBeDefined();
    expect(result.dataPoints).toBe(2);
  });

  test('calcMedian odd array', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.calcMedian([1, 3, 5, 7, 9]));
    expect(result).toBe(5);
  });

  test('calcMedian even array', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.calcMedian([1, 3, 5, 7]));
    expect(result).toBe(4);
  });

  test('formatChange HR improvement (lower is better)', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(65, 60, true));
    expect(result).toContain('text-green-400');
    expect(result).toContain('↓');
  });

  test('formatChange score improvement (higher is better)', async ({ page }) => {
    const result = await page.evaluate(() => window.Comparison.formatChange(75, 85, false));
    expect(result).toContain('text-green-400');
    expect(result).toContain('↑');
  });
});
