// @ts-check
const { test, expect } = require('@playwright/test');

// =============================================================================
// AI Insight Card Persistence Test
//
// Reproduces the bug where the AI insight card flashes and disappears on the
// dashboard. The card appears briefly then vanishes because _renderContent is
// called multiple times (cache render, fresh data render, background sync render),
// and each call re-evaluates the AI container state.
// =============================================================================

/**
 * Generate 10 days of realistic sleep data
 */
function generateSleepData() {
  const data = [];
  const baseDate = new Date();
  for (let i = 0; i < 10; i++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    // Bedtime around 22:00-23:30
    const bedHour = 22 + Math.random();
    const bedtime = new Date(d);
    bedtime.setHours(Math.floor(bedHour), Math.floor((bedHour % 1) * 60), 0, 0);
    data.push({
      date: dateStr,
      sleep_score: Math.round(70 + Math.random() * 20),
      deep_sleep_minutes: Math.round(50 + Math.random() * 40),
      avg_hr: Math.round(55 + Math.random() * 10),
      pre_sleep_hr: Math.round(52 + Math.random() * 8),
      total_sleep_minutes: Math.round(360 + Math.random() * 120),
      bedtime_start: bedtime.toISOString(),
    });
  }
  return data;
}

const MOCK_SLEEP_DATA = generateSleepData();

const MOCK_AI_RESPONSE = {
  insight:
    '- Your bedtime before 11pm correlates with 15% better scores.\n- Deep sleep has dropped 20% over the past week.\n- Your resting HR is trending up 3bpm.',
};

/**
 * Bypass auth and show the main app content.
 */
async function showApp(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => {
      const auth = document.getElementById('auth-section');
      return auth && !auth.classList.contains('hidden');
    },
    { timeout: 5000 }
  ).catch(() => {});

  await page.evaluate(() => {
    document.getElementById('auth-section').classList.add('hidden');
    const onboarding = document.getElementById('onboarding-section');
    if (onboarding) onboarding.classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    document.querySelector('.bottom-nav')?.classList.remove('hidden');
  });
}

/**
 * Mock Supabase and all data sources so the dashboard renders with sleep data
 * but no active challenges (simplest case to isolate AI card behavior).
 */
async function mockSupabaseWithSleepData(page, sleepData) {
  await page.evaluate((data) => {
    SupabaseClient.getCurrentUser = () =>
      Promise.resolve({ id: 'test-user-id', email: 'test@example.com' });
    SupabaseClient.signOut = async () => {};

    // Mock profile
    Auth.getProfile = () =>
      Promise.resolve({
        display_name: 'Test User',
        oura_token: null, // no Oura token so _backgroundSync is skipped
        onboarding_step: 2,
      });

    // Mock Challenges to return no active challenges
    Challenges.getActiveChallenges = () => Promise.resolve([]);
    Challenges.getMyChallenges = () => Promise.resolve([]);

    // Mock Dashboard.getRecentSleepData to return our sleep data
    Dashboard.getRecentSleepData = () => Promise.resolve(data);

    // Mock SleepSync to prevent background sync calls
    if (typeof SleepSync !== 'undefined') {
      SleepSync.syncNow = () => Promise.resolve({ success: false, count: 0 });
    }

    // Clear any cached dashboard data so we get a clean render cycle
    Cache.clearAll();

    // Reset AI fetch state
    Dashboard._aiFetchInFlight = false;
    Dashboard._aiFetchFailed = false;
    Dashboard._aiCardRenderedInsight = null;
    Dashboard._renderGeneration = 0;

    // Mock global getCurrentUser (used by _fetchChatContext) to prevent hanging
    window.getCurrentUser = () => Promise.resolve({ id: 'test-user-id', email: 'test@example.com' });
    // Also mock supabase auth.getSession in case getCurrentUser goes through getSession
    if (SupabaseClient.client && SupabaseClient.client.auth) {
      SupabaseClient.client.auth.getSession = () => Promise.resolve({
        data: { session: { user: { id: 'test-user-id', email: 'test@example.com' } } },
        error: null
      });
    }

    // Mock the Supabase client.from for any remaining direct DB calls
    const mockQuery = {
      select: () => mockQuery,
      eq: () => mockQuery,
      neq: () => mockQuery,
      is: () => mockQuery,
      limit: () => mockQuery,
      gte: () => mockQuery,
      lte: () => mockQuery,
      or: () => mockQuery,
      order: () => mockQuery,
      single: () =>
        Promise.resolve({
          data: {
            display_name: 'Test User',
            oura_token: null,
            onboarding_step: 2,
          },
          error: null,
        }),
      insert: () => Promise.resolve({ data: {}, error: null }),
      update: () => mockQuery,
      delete: () => mockQuery,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (fn) => Promise.resolve({ data: [], error: null }).then(fn),
    };

    SupabaseClient.client.from = () => ({
      ...mockQuery,
      select: () => ({
        ...mockQuery,
        eq: () => ({
          ...mockQuery,
          eq: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data, error: null }),
          single: () =>
            Promise.resolve({
              data: {
                display_name: 'Test User',
                oura_token: null,
                onboarding_step: 2,
              },
              error: null,
            }),
        }),
        or: () => Promise.resolve({ data: [], error: null }),
        order: () => Promise.resolve({ data: [], error: null }),
        neq: () => ({
          ...mockQuery,
          single: () =>
            Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
        }),
      }),
    });
  }, sleepData);
}

// =============================================================================
// Test: AI Card Persistence on Mobile Safari (iPhone viewport)
// =============================================================================

test.describe('AI Insight Card Persistence', () => {
  // Only run on Mobile Safari project (iPhone viewport) to match the bug context
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  });

  test('AI insight card should appear and persist after loading', async ({ page }) => {
    // Set up route intercept for the AI insight endpoint BEFORE navigating
    // Use a 700ms delay to simulate realistic API latency
    await page.route('**/api/ai/insight', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_AI_RESPONSE),
      });
    });

    await showApp(page);
    await mockSupabaseWithSleepData(page, MOCK_SLEEP_DATA);

    // Install a MutationObserver on #ai-insight-container BEFORE triggering render
    // This records every innerHTML change with a timestamp
    await page.evaluate(() => {
      window._aiContainerLog = [];
      const aiContainer = document.getElementById('ai-insight-container');
      if (!aiContainer) {
        window._aiContainerLog.push({
          time: Date.now(),
          event: 'CONTAINER_NOT_FOUND',
          html: '',
        });
        return;
      }

      // Record initial state
      window._aiContainerLog.push({
        time: Date.now(),
        event: 'INITIAL',
        html: aiContainer.innerHTML.trim(),
        hasContent: aiContainer.innerHTML.trim().length > 0,
      });

      // Watch for all changes
      const observer = new MutationObserver((mutations) => {
        const currentHtml = aiContainer.innerHTML.trim();
        const hasSkeleton = currentHtml.includes('ai-skeleton-card') || currentHtml.includes('skeleton-bar');
        const hasRealCard = currentHtml.includes('Daily Insight');
        const isEmpty = currentHtml.length === 0;

        let event = 'MUTATION';
        if (isEmpty) event = 'CLEARED';
        else if (hasSkeleton) event = 'SKELETON';
        else if (hasRealCard) event = 'REAL_CARD';

        window._aiContainerLog.push({
          time: Date.now(),
          event,
          htmlLength: currentHtml.length,
          hasSkeleton,
          hasRealCard,
          isEmpty,
          htmlPreview: currentHtml.slice(0, 200),
        });
      });

      observer.observe(aiContainer, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });

      window._aiContainerObserver = observer;
    });

    // Also track style/opacity changes that could cause visual disappearance
    await page.evaluate(() => {
      const aiContainer = document.getElementById('ai-insight-container');
      if (!aiContainer) return;

      const styleObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'style') {
            window._aiContainerLog.push({
              time: Date.now(),
              event: 'STYLE_CHANGE',
              style: aiContainer.style.cssText,
              opacity: aiContainer.style.opacity,
            });
          }
        }
      });
      styleObserver.observe(aiContainer, { attributes: true, attributeFilter: ['style'] });
    });

    // Take screenshot before render
    await page.screenshot({
      path: 'tests/e2e/screenshots/ai-card-01-before-render.png',
      fullPage: true,
    });

    // Navigate to dashboard to trigger render
    await page.evaluate(() => App.navigateTo('dashboard'));

    // Wait a moment for the initial synchronous render
    await page.waitForTimeout(200);
    await page.screenshot({
      path: 'tests/e2e/screenshots/ai-card-02-after-initial-render.png',
      fullPage: true,
    });

    // Check for skeleton card
    const skeletonAppeared = await page.evaluate(() => {
      const ac = document.getElementById('ai-insight-container');
      return ac && ac.innerHTML.includes('skeleton');
    });

    // Wait for the AI fetch to complete
    // With slowMo:500 in playwright config, network roundtrips are slower.
    // The 700ms route delay + slowMo overhead means we need ~4s total.
    await page.waitForFunction(
      () => {
        const ac = document.getElementById('ai-insight-container');
        return ac && ac.innerHTML.includes('Daily Insight');
      },
      { timeout: 10000 }
    ).catch(() => {});

    await page.screenshot({
      path: 'tests/e2e/screenshots/ai-card-03-after-ai-fetch.png',
      fullPage: true,
    });

    // Check if real card appeared
    const realCardVisible = await page.evaluate(() => {
      const ac = document.getElementById('ai-insight-container');
      return ac && ac.innerHTML.includes('Daily Insight');
    });

    // Wait another 3s to see if anything changes (re-renders, disappearance)
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: 'tests/e2e/screenshots/ai-card-04-after-settling.png',
      fullPage: true,
    });

    // Check final state
    const finalState = await page.evaluate(() => {
      const ac = document.getElementById('ai-insight-container');
      return {
        exists: !!ac,
        html: ac ? ac.innerHTML.trim() : '',
        hasRealCard: ac ? ac.innerHTML.includes('Daily Insight') : false,
        hasSkeleton: ac ? ac.innerHTML.includes('skeleton') : false,
        isEmpty: ac ? ac.innerHTML.trim().length === 0 : true,
        opacity: ac ? getComputedStyle(ac).opacity : 'N/A',
        display: ac ? getComputedStyle(ac).display : 'N/A',
        visibility: ac ? getComputedStyle(ac).visibility : 'N/A',
      };
    });

    // Get the full mutation log
    const mutationLog = await page.evaluate(() => window._aiContainerLog);

    // Analyze the log for the flash-and-disappear pattern
    const events = mutationLog.map((e) => e.event);
    const realCardAppearances = events.filter((e) => e === 'REAL_CARD').length;
    const clearEvents = events.filter((e) => e === 'CLEARED').length;
    const skeletonEvents = events.filter((e) => e === 'SKELETON').length;

    // Log detailed findings
    console.log('=== AI INSIGHT CONTAINER MUTATION LOG ===');
    console.log(`Total mutations: ${mutationLog.length}`);
    console.log(`Skeleton appearances: ${skeletonEvents}`);
    console.log(`Real card appearances: ${realCardAppearances}`);
    console.log(`Clear events: ${clearEvents}`);
    console.log(`Event sequence: ${events.join(' -> ')}`);
    console.log('');
    console.log('=== DETAILED LOG ===');
    for (const entry of mutationLog) {
      const relTime = entry.time - mutationLog[0].time;
      console.log(
        `  [+${relTime}ms] ${entry.event}` +
          (entry.htmlLength !== undefined ? ` (${entry.htmlLength} chars)` : '') +
          (entry.style !== undefined ? ` style="${entry.style}"` : '') +
          (entry.htmlPreview ? ` preview: ${entry.htmlPreview.slice(0, 80)}...` : '')
      );
    }
    console.log('');
    console.log('=== FINAL STATE ===');
    console.log(`  Container exists: ${finalState.exists}`);
    console.log(`  Has real card: ${finalState.hasRealCard}`);
    console.log(`  Has skeleton: ${finalState.hasSkeleton}`);
    console.log(`  Is empty: ${finalState.isEmpty}`);
    console.log(`  Opacity: ${finalState.opacity}`);
    console.log(`  Display: ${finalState.display}`);
    console.log(`  Visibility: ${finalState.visibility}`);
    console.log(`  HTML length: ${finalState.html.length}`);

    // ─── Assertions ───
    // The skeleton should have appeared at some point
    expect(skeletonAppeared).toBe(true);

    // The real card should have appeared
    expect(realCardVisible).toBe(true);

    // CRITICAL: The real card should STILL be present in the final state
    // This is the bug check — if it flashes and disappears, this fails
    expect(finalState.hasRealCard).toBe(true);
    expect(finalState.isEmpty).toBe(false);
    expect(finalState.opacity).not.toBe('0');
  });

  test('AI card survives multiple _renderContent calls (simulated re-render cycle)', async ({
    page,
  }) => {
    // This test simulates the exact sequence that causes the flash:
    // 1. _renderContent from cache (shows skeleton, starts fetch)
    // 2. _renderContent from fresh data (may clear or re-show skeleton)
    // 3. AI fetch completes (shows real card)
    // 4. _renderContent from background sync (may clear real card)

    await page.route('**/api/ai/insight', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_AI_RESPONSE),
      });
    });

    await showApp(page);
    await mockSupabaseWithSleepData(page, MOCK_SLEEP_DATA);

    // Install mutation observer
    await page.evaluate(() => {
      window._aiLog = [];
      const ac = document.getElementById('ai-insight-container');
      if (!ac) return;

      const snap = () => ({
        time: Date.now(),
        html: ac.innerHTML.trim(),
        hasCard: ac.innerHTML.includes('Daily Insight'),
        hasSkeleton: ac.innerHTML.includes('skeleton'),
        isEmpty: ac.innerHTML.trim().length === 0,
      });

      window._aiLog.push({ ...snap(), event: 'INIT' });

      new MutationObserver(() => {
        const s = snap();
        const prev = window._aiLog[window._aiLog.length - 1];
        // Only log if state actually changed
        if (
          s.hasCard !== prev.hasCard ||
          s.hasSkeleton !== prev.hasSkeleton ||
          s.isEmpty !== prev.isEmpty
        ) {
          let event = 'CHANGE';
          if (s.isEmpty) event = 'CLEARED';
          else if (s.hasSkeleton) event = 'SKELETON';
          else if (s.hasCard) event = 'REAL_CARD';
          window._aiLog.push({ ...s, event });
        }
      }).observe(ac, { childList: true, subtree: true, characterData: true });
    });

    // Trigger the dashboard render
    await page.evaluate(() => App.navigateTo('dashboard'));

    // Wait for the AI card to appear (route intercept + slowMo makes this slow)
    await page.waitForFunction(
      () => {
        const ac = document.getElementById('ai-insight-container');
        return ac && ac.innerHTML.includes('Daily Insight');
      },
      { timeout: 15000 }
    ).catch(() => {});

    // Wait an additional 3s for any subsequent re-renders that might clear the card
    await page.waitForTimeout(3000);

    // Get the state transition log
    const log = await page.evaluate(() => window._aiLog);
    const transitions = log.map((e) => e.event);

    console.log('=== AI CARD STATE TRANSITIONS ===');
    for (const entry of log) {
      const relTime = entry.time - log[0].time;
      console.log(`  [+${relTime}ms] ${entry.event} (card=${entry.hasCard}, skeleton=${entry.hasSkeleton}, empty=${entry.isEmpty})`);
    }

    // Check for the flash pattern: REAL_CARD followed by CLEARED
    let flashDetected = false;
    for (let i = 1; i < transitions.length; i++) {
      if (transitions[i] === 'CLEARED' && transitions[i - 1] === 'REAL_CARD') {
        flashDetected = true;
        console.log(`  >>> FLASH DETECTED: Real card appeared at index ${i - 1}, then cleared at index ${i}`);
      }
    }

    // Check for double-flash: card appears, disappears, appears, disappears
    let doubleFlash = false;
    const cardAppearances = transitions.filter((t) => t === 'REAL_CARD').length;
    const clearAfterCard = transitions.filter(
      (t, i) => t === 'CLEARED' && i > 0 && transitions[i - 1] === 'REAL_CARD'
    ).length;
    if (cardAppearances >= 2 && clearAfterCard >= 2) {
      doubleFlash = true;
      console.log('  >>> DOUBLE FLASH DETECTED: Card appeared and vanished multiple times');
    }

    // Final state
    const finalState = await page.evaluate(() => {
      const ac = document.getElementById('ai-insight-container');
      return {
        hasCard: ac?.innerHTML.includes('Daily Insight') || false,
        isEmpty: !ac || ac.innerHTML.trim().length === 0,
      };
    });

    console.log(`\n  Final state: card=${finalState.hasCard}, empty=${finalState.isEmpty}`);
    console.log(`  Flash detected: ${flashDetected}`);
    console.log(`  Double flash: ${doubleFlash}`);

    // The card should persist in the final state
    expect(finalState.hasCard).toBe(true);
    expect(finalState.isEmpty).toBe(false);

    // No flash-and-disappear should occur
    if (flashDetected) {
      console.log('\n  BUG CONFIRMED: AI card flashes and disappears!');
    }
    expect(flashDetected).toBe(false);
  });

  test('AI card handles failed fetch without flash (graceful degradation)', async ({ page }) => {
    // Simulate /api/ai/insight returning an error
    let routeHitCount = 0;
    await page.route('**/api/ai/insight', async (route) => {
      routeHitCount++;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await showApp(page);
    await mockSupabaseWithSleepData(page, MOCK_SLEEP_DATA);

    // Install detailed mutation observer
    await page.evaluate(() => {
      window._failLog = [];
      const ac = document.getElementById('ai-insight-container');
      if (!ac) return;

      new MutationObserver(() => {
        const html = ac.innerHTML.trim();
        window._failLog.push({
          time: Date.now(),
          hasSkeleton: html.includes('skeleton'),
          hasCard: html.includes('Daily Insight'),
          isEmpty: html.length === 0,
          opacity: ac.style.opacity || '',
          htmlLength: html.length,
        });
      }).observe(ac, { childList: true, subtree: true, attributes: true });
    });

    await page.evaluate(() => App.navigateTo('dashboard'));

    // Wait for fetch to fail and fade-out animation to complete
    // With slowMo:500 the 300ms route delay becomes ~3s+ for the full network roundtrip
    // Plus 300ms for the opacity fade-out setTimeout
    await page.waitForTimeout(8000);

    const log = await page.evaluate(() => window._failLog);
    const finalState = await page.evaluate(() => {
      const ac = document.getElementById('ai-insight-container');
      return {
        html: ac?.innerHTML.trim() || '',
        isEmpty: !ac || ac.innerHTML.trim().length === 0,
        opacity: ac ? getComputedStyle(ac).opacity : '1',
        inlineOpacity: ac?.style.opacity || '',
        renderGeneration: Dashboard._renderGeneration,
        fetchInFlight: Dashboard._aiFetchInFlight,
      };
    });

    console.log('=== FAILED FETCH TEST ===');
    console.log(`  Total mutations: ${log.length}`);
    for (const entry of log) {
      const relTime = log.length > 0 ? entry.time - log[0].time : 0;
      console.log(
        `  [+${relTime}ms] skeleton=${entry.hasSkeleton}, card=${entry.hasCard}, empty=${entry.isEmpty}, opacity="${entry.opacity}", len=${entry.htmlLength}`
      );
    }
    console.log(`  Final: empty=${finalState.isEmpty}, opacity=${finalState.opacity}, inlineOpacity="${finalState.inlineOpacity}"`);
    console.log(`  Final HTML length: ${finalState.html.length}`);
    console.log(`  renderGeneration: ${finalState.renderGeneration}, fetchInFlight: ${finalState.fetchInFlight}`);
    console.log(`  Route hit count: ${routeHitCount}`);

    // After a failed fetch, the skeleton should be cleaned up.
    // The fade-out code (opacity 0 -> clear innerHTML after 300ms) should run.
    // If it doesn't (e.g., generation check bails early), the skeleton is stuck.
    const hasStuckSkeleton =
      !finalState.isEmpty && finalState.html.includes('skeleton');
    if (hasStuckSkeleton) {
      console.log('  >>> FINDING: Skeleton is stuck after failed fetch!');
      console.log('  This happens when gen !== _renderGeneration at line 881,');
      console.log('  which prevents the fade-out cleanup from executing.');
    }
    // Document findings about the failed fetch behavior
    if (hasStuckSkeleton) {
      console.log('  >>> FINDING: Skeleton stuck after failed AI fetch.');
    }

    const finalHasCard = log.some((e) => e.hasCard);
    if (finalHasCard && routeHitCount === 0) {
      console.log('  >>> FINDING: Real card appeared but route was never hit!');
      console.log('  This means the fetch went to the real server or used cached data.');
    } else if (finalHasCard && routeHitCount > 0) {
      console.log('  >>> FINDING: Real card appeared despite 500 route response.');
      console.log('  The fetch may have been retried or cached from a previous test.');
    }

    // The container should not have a stuck skeleton (either cleared or showing card)
    // After a failed fetch, skeleton should fade out via the opacity animation
    expect(hasStuckSkeleton).toBe(false);
  });

  test('track exact innerHTML contents at each stage of render cycle', async ({ page }) => {
    // The most granular test: captures exact HTML at each stage
    let aiRequestCount = 0;

    await page.route('**/api/ai/insight', async (route) => {
      aiRequestCount++;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_AI_RESPONSE),
      });
    });

    await showApp(page);
    await mockSupabaseWithSleepData(page, MOCK_SLEEP_DATA);

    // Intercept every single _renderContent call to log what it does to AI container
    await page.evaluate(() => {
      window._renderContentCalls = [];
      const originalRenderContent = Dashboard._renderContent.bind(Dashboard);

      Dashboard._renderContent = function (container, data) {
        const acBefore = document.getElementById('ai-insight-container');
        const htmlBefore = acBefore ? acBefore.innerHTML.trim() : 'N/A';

        originalRenderContent(container, data);

        const acAfter = document.getElementById('ai-insight-container');
        const htmlAfter = acAfter ? acAfter.innerHTML.trim() : 'N/A';

        window._renderContentCalls.push({
          time: Date.now(),
          sleepDataCount: data.recentSleep?.length || 0,
          hasChallenges: (data.activeChallenges?.length || 0) > 0,
          aiBefore: {
            length: htmlBefore.length,
            hasSkeleton: htmlBefore.includes('skeleton'),
            hasCard: htmlBefore.includes('Daily Insight'),
            isEmpty: htmlBefore.length === 0,
          },
          aiAfter: {
            length: htmlAfter.length,
            hasSkeleton: htmlAfter.includes('skeleton'),
            hasCard: htmlAfter.includes('Daily Insight'),
            isEmpty: htmlAfter.length === 0,
          },
          aiFetchInFlight: Dashboard._aiFetchInFlight,
          renderGeneration: Dashboard._renderGeneration,
        });
      };
    });

    // Navigate to dashboard
    await page.evaluate(() => App.navigateTo('dashboard'));

    // Wait for AI card to appear (route intercept + slowMo overhead)
    await page.waitForFunction(
      () => {
        const ac = document.getElementById('ai-insight-container');
        return ac && ac.innerHTML.includes('Daily Insight');
      },
      { timeout: 15000 }
    ).catch(() => {});

    // Wait a bit more for any subsequent re-renders that might clear the card
    await page.waitForTimeout(2000);

    const renderCalls = await page.evaluate(() => window._renderContentCalls);

    console.log('=== _renderContent CALL LOG ===');
    console.log(`Total _renderContent calls: ${renderCalls.length}`);
    console.log(`AI /api/ai/insight requests: ${aiRequestCount}`);
    console.log('');

    for (let i = 0; i < renderCalls.length; i++) {
      const call = renderCalls[i];
      const relTime = i === 0 ? 0 : call.time - renderCalls[0].time;
      console.log(`  Call #${i + 1} [+${relTime}ms]:`);
      console.log(`    Sleep data: ${call.sleepDataCount} rows, challenges: ${call.hasChallenges}`);
      console.log(`    Generation: ${call.renderGeneration}, fetchInFlight: ${call.aiFetchInFlight}`);
      console.log(
        `    AI BEFORE: length=${call.aiBefore.length}, skeleton=${call.aiBefore.hasSkeleton}, card=${call.aiBefore.hasCard}, empty=${call.aiBefore.isEmpty}`
      );
      console.log(
        `    AI AFTER:  length=${call.aiAfter.length}, skeleton=${call.aiAfter.hasSkeleton}, card=${call.aiAfter.hasCard}, empty=${call.aiAfter.isEmpty}`
      );
    }

    // Final state check
    const finalState = await page.evaluate(() => {
      const ac = document.getElementById('ai-insight-container');
      return {
        hasCard: ac?.innerHTML.includes('Daily Insight') || false,
        hasSkeleton: ac?.innerHTML.includes('skeleton') || false,
        isEmpty: !ac || ac.innerHTML.trim().length === 0,
        htmlLength: ac?.innerHTML.trim().length || 0,
      };
    });

    console.log(`\n  Final state: card=${finalState.hasCard}, skeleton=${finalState.hasSkeleton}, empty=${finalState.isEmpty}, length=${finalState.htmlLength}`);

    // The card should persist
    expect(finalState.hasCard).toBe(true);
    expect(finalState.isEmpty).toBe(false);
  });

  test('AI card persists when dashboard has cached data (multi-render path)', async ({ page }) => {
    // THIS IS THE KEY BUG SCENARIO:
    // When the dashboard cache is populated, Dashboard.render() calls _renderContent
    // TWICE: once immediately from cache, and once after fetching fresh data.
    // If oura_token is set, it calls _renderContent a THIRD time after background sync.
    // Each _renderContent call re-evaluates the AI container. The bug is:
    // 1. First _renderContent (cache) -> shows skeleton, starts AI fetch
    // 2. AI fetch completes -> shows real card
    // 3. Second _renderContent (fresh data) -> may re-show skeleton or clear card
    //    because the cached insight was stored under a key that may not match,
    //    or the _aiFetchInFlight flag is stale.

    await page.route('**/api/ai/insight', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_AI_RESPONSE),
      });
    });

    await showApp(page);
    await mockSupabaseWithSleepData(page, MOCK_SLEEP_DATA);

    // Pre-populate the dashboard cache so render() will call _renderContent
    // from cache first, then again with fresh data — the multi-render path.
    await page.evaluate((data) => {
      Cache.set('dashboard', {
        profile: {
          display_name: 'Test User',
          oura_token: 'fake-token-for-sync', // Enable background sync path
          onboarding_step: 2,
        },
        activeChallenges: [],
        recentSleep: data,
        leagueData: null,
      });

      // Re-mock profile with oura_token to trigger background sync path
      Auth.getProfile = () =>
        Promise.resolve({
          display_name: 'Test User',
          oura_token: 'fake-token-for-sync',
          onboarding_step: 2,
        });

      // Mock SleepSync.syncNow to return success with count > 0
      // This triggers a THIRD _renderContent call from _backgroundSync
      if (typeof SleepSync !== 'undefined') {
        SleepSync.syncNow = () => Promise.resolve({ success: true, count: 1 });
      }
    }, MOCK_SLEEP_DATA);

    // Install detailed observer
    await page.evaluate(() => {
      window._multiRenderLog = [];
      const ac = document.getElementById('ai-insight-container');
      if (!ac) return;

      // Track _renderContent calls
      window._renderContentCount = 0;
      const originalRC = Dashboard._renderContent.bind(Dashboard);
      Dashboard._renderContent = function (container, data) {
        window._renderContentCount++;
        const callNum = window._renderContentCount;
        const beforeHtml = ac.innerHTML.trim();

        originalRC(container, data);

        const afterHtml = ac.innerHTML.trim();
        window._multiRenderLog.push({
          time: Date.now(),
          event: `RENDER_CONTENT_#${callNum}`,
          beforeCard: beforeHtml.includes('Daily Insight'),
          beforeSkeleton: beforeHtml.includes('skeleton'),
          beforeEmpty: beforeHtml.length === 0,
          afterCard: afterHtml.includes('Daily Insight'),
          afterSkeleton: afterHtml.includes('skeleton'),
          afterEmpty: afterHtml.length === 0,
          generation: Dashboard._renderGeneration,
          fetchInFlight: Dashboard._aiFetchInFlight,
        });
      };

      // Track all AI container mutations
      new MutationObserver(() => {
        const html = ac.innerHTML.trim();
        window._multiRenderLog.push({
          time: Date.now(),
          event: 'MUTATION',
          hasCard: html.includes('Daily Insight'),
          hasSkeleton: html.includes('skeleton'),
          isEmpty: html.length === 0,
          opacity: ac.style.opacity || '1',
          htmlLength: html.length,
        });
      }).observe(ac, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
    });

    // Navigate to dashboard — triggers multi-render path
    await page.evaluate(() => App.navigateTo('dashboard'));

    // Wait for AI card to appear
    await page.waitForFunction(
      () => {
        const ac = document.getElementById('ai-insight-container');
        return ac && ac.innerHTML.includes('Daily Insight');
      },
      { timeout: 15000 }
    ).catch(() => {});

    // Wait for subsequent re-renders (fresh data + background sync) to potentially clear it
    await page.waitForTimeout(5000);

    const log = await page.evaluate(() => window._multiRenderLog);

    console.log('=== MULTI-RENDER PATH LOG (with cached data) ===');
    const startTime = log.length > 0 ? log[0].time : 0;
    for (const entry of log) {
      const relTime = entry.time - startTime;
      if (entry.event.startsWith('RENDER_CONTENT')) {
        console.log(`  [+${relTime}ms] ${entry.event}`);
        console.log(`    gen=${entry.generation}, fetchInFlight=${entry.fetchInFlight}`);
        console.log(`    BEFORE: card=${entry.beforeCard}, skeleton=${entry.beforeSkeleton}, empty=${entry.beforeEmpty}`);
        console.log(`    AFTER:  card=${entry.afterCard}, skeleton=${entry.afterSkeleton}, empty=${entry.afterEmpty}`);
      } else {
        console.log(
          `  [+${relTime}ms] ${entry.event}: card=${entry.hasCard}, skeleton=${entry.hasSkeleton}, empty=${entry.isEmpty}, opacity=${entry.opacity}, len=${entry.htmlLength}`
        );
      }
    }

    const renderContentCount = await page.evaluate(() => window._renderContentCount);
    console.log(`\n  Total _renderContent calls: ${renderContentCount}`);

    // Check final state
    const finalState = await page.evaluate(() => {
      const ac = document.getElementById('ai-insight-container');
      return {
        hasCard: ac?.innerHTML.includes('Daily Insight') || false,
        hasSkeleton: ac?.innerHTML.includes('skeleton') || false,
        isEmpty: !ac || ac.innerHTML.trim().length === 0,
        opacity: ac ? getComputedStyle(ac).opacity : '1',
      };
    });

    console.log(`  Final: card=${finalState.hasCard}, skeleton=${finalState.hasSkeleton}, empty=${finalState.isEmpty}, opacity=${finalState.opacity}`);

    // Detect any flash pattern in the mutation log
    let sawCardThenGone = false;
    let cardWasEverVisible = false;
    for (const entry of log) {
      if (entry.event === 'MUTATION') {
        if (entry.hasCard) cardWasEverVisible = true;
        if (cardWasEverVisible && entry.isEmpty) {
          sawCardThenGone = true;
          console.log('  >>> BUG: Card appeared then was cleared!');
        }
        if (cardWasEverVisible && entry.hasSkeleton) {
          sawCardThenGone = true;
          console.log('  >>> BUG: Card appeared then reverted to skeleton!');
        }
      }
      if (entry.event.startsWith('RENDER_CONTENT')) {
        if (entry.beforeCard && !entry.afterCard) {
          sawCardThenGone = true;
          console.log(`  >>> BUG: ${entry.event} cleared the real card!`);
        }
      }
    }

    if (sawCardThenGone) {
      console.log('\n  BUG CONFIRMED: AI card flashes and disappears in multi-render path!');
    }

    // The card should persist through all re-renders
    expect(finalState.hasCard).toBe(true);
    expect(finalState.isEmpty).toBe(false);
    expect(sawCardThenGone).toBe(false);
  });
});
