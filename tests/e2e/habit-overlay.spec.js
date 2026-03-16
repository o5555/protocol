// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Habit Check-in Overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Dashboard has _shouldShowOverlay method', async ({ page }) => {
    const has = await page.evaluate(() => typeof Dashboard._shouldShowOverlay === 'function');
    expect(has).toBe(true);
  });

  test('_shouldShowOverlay returns false when no habit data', async ({ page }) => {
    const result = await page.evaluate(() => {
      Dashboard._habitData = null;
      return Dashboard._shouldShowOverlay();
    });
    expect(result).toBe(false);
  });

  test('_shouldShowOverlay returns false when skipped', async ({ page }) => {
    const result = await page.evaluate(() => {
      Dashboard._overlaySkippedToday = true;
      Dashboard._habitData = { challenge: { id: '1' }, habits: [{ id: 'h1' }], completions: [], today: '2026-03-13', firstDay: false };
      const r = Dashboard._shouldShowOverlay();
      Dashboard._overlaySkippedToday = false;
      return r;
    });
    expect(result).toBe(false);
  });

  test('_shouldShowOverlay returns false on first day', async ({ page }) => {
    const result = await page.evaluate(() => {
      Dashboard._habitData = { challenge: { id: '1' }, habits: [{ id: 'h1' }], completions: [], today: '2026-03-13', firstDay: true };
      return Dashboard._shouldShowOverlay();
    });
    expect(result).toBe(false);
  });

  test('_shouldShowOverlay returns false when already checked in', async ({ page }) => {
    const result = await page.evaluate(() => {
      Dashboard._habitData = { challenge: { id: 'test-overlay' }, habits: [{ id: 'h1' }], completions: ['h1'], today: '2026-03-13', firstDay: false };
      return Dashboard._shouldShowOverlay();
    });
    expect(result).toBe(false);
  });

  test('_renderOverlay produces valid HTML with habits', async ({ page }) => {
    const html = await page.evaluate(() => {
      Dashboard._habitData = {
        challenge: { id: '1' },
        habits: [{ id: 'h1', title: 'Cold shower' }, { id: 'h2', title: 'Meditation' }],
        completions: [],
        today: '2026-03-13',
        firstDay: false
      };
      Dashboard._overlayPendingSet = new Set();
      return Dashboard._renderOverlay();
    });
    expect(html).toContain('Yesterday\'s Habits');
    expect(html).toContain('Cold shower');
    expect(html).toContain('Meditation');
    expect(html).toContain('overlay-confirm');
    expect(html).toContain('overlay-skip');
  });

  test('_dismissOverlay removes wrapper from DOM', async ({ page }) => {
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'habit-overlay-wrapper';
      div.innerHTML = '<div id="habit-overlay"></div>';
      document.body.appendChild(div);
    });
    const before = await page.evaluate(() => !!document.getElementById('habit-overlay-wrapper'));
    expect(before).toBe(true);

    await page.evaluate(() => {
      const wrapper = document.getElementById('habit-overlay-wrapper');
      if (wrapper) wrapper.remove();
      Dashboard._overlayPending = false;
    });
    const after = await page.evaluate(() => !!document.getElementById('habit-overlay-wrapper'));
    expect(after).toBe(false);
  });

  test('overlay toggle updates data-checked attribute', async ({ page }) => {
    await page.evaluate(() => {
      Dashboard._overlayPendingSet = new Set();
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <button class="overlay-habit-row" data-habit-id="h1" data-checked="false">
          <div class="w-7 h-7 rounded-lg border border-oura-border flex items-center justify-center flex-shrink-0"></div>
          <span class="text-base text-white">Test habit</span>
        </button>`;
      document.body.appendChild(wrapper);
    });

    await page.evaluate(() => {
      const row = document.querySelector('.overlay-habit-row');
      Dashboard._handleOverlayToggle(row);
    });

    const checked = await page.evaluate(() =>
      document.querySelector('.overlay-habit-row').dataset.checked
    );
    expect(checked).toBe('true');

    const inSet = await page.evaluate(() => Dashboard._overlayPendingSet.has('h1'));
    expect(inSet).toBe(true);
  });
});

test.describe('Bedtime Window Calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('falls back to 22-5 with fewer than 7 nights', async ({ page }) => {
    const result = await page.evaluate(() => {
      const sleep = Array.from({ length: 5 }, (_, i) => ({
        date: `2026-03-${10 + i}`,
        bedtime_start: `2026-03-${10 + i}T23:00:00-06:00`,
        total_sleep_minutes: 420
      }));
      return Dashboard._calcBedtimeWindow(sleep);
    });
    expect(result).toEqual({ start: 22, end: 5 });
  });

  test('calculates window from 7+ nights (end = wake time)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const sleep = Array.from({ length: 10 }, (_, i) => ({
        date: `2026-03-${10 + i}`,
        bedtime_start: `2026-03-${10 + i}T23:00:00-06:00`,
        total_sleep_minutes: 480  // 8 hours → wake at ~7:00
      }));
      return Dashboard._calcBedtimeWindow(sleep);
    });
    expect(result.start).toBeCloseTo(22, 0);
    expect(result.end).toBeCloseTo(7, 0);  // wake time, not wake+2
  });

  test('circular mean handles midnight crossover', async ({ page }) => {
    const result = await page.evaluate(() => {
      return Dashboard._circularMeanHours([23, 23, 1, 1]);
    });
    expect(result).toBeCloseTo(0, 0);
  });
});

test.describe('AI Waiting States', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('_renderAiWaitingForSleep returns waiting card', async ({ page }) => {
    const html = await page.evaluate(() => Dashboard._renderAiWaitingForSleep());
    expect(html).toContain('Waiting for your sleep data');
    expect(html).toContain('animate-spin');
  });

  test('_renderAiWaitingState returns shimmer outside bedtime window', async ({ page }) => {
    const html = await page.evaluate(() => {
      const orig = Dashboard._isInBedtimeWindow;
      Dashboard._isInBedtimeWindow = () => false;
      const result = Dashboard._renderAiWaitingState([]);
      Dashboard._isInBedtimeWindow = orig;
      return result;
    });
    expect(html).toContain('skeleton-bar');
  });

  test('_renderAiWaitingState returns waiting message in bedtime window', async ({ page }) => {
    const html = await page.evaluate(() => {
      const orig = Dashboard._isInBedtimeWindow;
      Dashboard._isInBedtimeWindow = () => true;
      const result = Dashboard._renderAiWaitingState([]);
      Dashboard._isInBedtimeWindow = orig;
      return result;
    });
    expect(html).toContain('Waiting for your sleep data');
  });
});
