// @ts-check
/**
 * Sleep Session Aggregation Tests
 *
 * Tests the logic that processes multiple Oura sleep sessions per day.
 * The correct behavior is:
 *   - Group all sessions by day
 *   - SUM total_sleep_duration, deep_sleep_duration, rem_sleep_duration,
 *     light_sleep_duration across all sessions for the same night
 *   - Take HR metrics (average_heart_rate, lowest_heart_rate) and bedtime_start
 *     from the primary session (longest long_sleep)
 */

const { test, expect } = require('@playwright/test');

// ─── Aggregation Logic (reference implementation) ────────────────────────────

/**
 * Aggregate multiple Oura sleep sessions by day.
 * Groups sessions by day, sums durations, takes HR from primary session.
 */
function aggregateSleepByDay(sessions) {
  const sessionsByDate = {};
  for (const sleep of sessions) {
    if (!sessionsByDate[sleep.day]) sessionsByDate[sleep.day] = [];
    sessionsByDate[sleep.day].push(sleep);
  }

  const result = {};
  for (const [day, daySessions] of Object.entries(sessionsByDate)) {
    const primary = [...daySessions].sort((a, b) => {
      const aLong = a.type === 'long_sleep' ? 1 : 0;
      const bLong = b.type === 'long_sleep' ? 1 : 0;
      if (aLong !== bLong) return bLong - aLong;
      return (b.total_sleep_duration || 0) - (a.total_sleep_duration || 0);
    })[0];

    result[day] = {
      day,
      total_sleep_duration: daySessions.reduce((sum, s) => sum + (s.total_sleep_duration || 0), 0),
      deep_sleep_duration: daySessions.reduce((sum, s) => sum + (s.deep_sleep_duration || 0), 0),
      rem_sleep_duration: daySessions.reduce((sum, s) => sum + (s.rem_sleep_duration || 0), 0),
      light_sleep_duration: daySessions.reduce((sum, s) => sum + (s.light_sleep_duration || 0), 0),
      average_heart_rate: primary.average_heart_rate || null,
      lowest_heart_rate: primary.lowest_heart_rate || null,
      bedtime_start: primary.bedtime_start || null,
      type: primary.type,
    };
  }
  return result;
}

/**
 * Convert aggregated session to the sleep_data record format.
 */
function toSleepRecord(aggregated, userId, scoresByDay = {}) {
  return {
    user_id: userId,
    date: aggregated.day,
    total_sleep_minutes: Math.round((aggregated.total_sleep_duration || 0) / 60),
    deep_sleep_minutes: Math.round((aggregated.deep_sleep_duration || 0) / 60),
    rem_sleep_minutes: Math.round((aggregated.rem_sleep_duration || 0) / 60),
    light_sleep_minutes: Math.round((aggregated.light_sleep_duration || 0) / 60),
    sleep_score: scoresByDay[aggregated.day] || null,
    avg_hr: aggregated.average_heart_rate || null,
    pre_sleep_hr: aggregated.lowest_heart_rate || null,
    bedtime_start: aggregated.bedtime_start || null,
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

test.describe('Sleep Session Aggregation Logic', () => {

  test('single session per night: values used as-is', () => {
    const sessions = [{
      day: '2026-02-15', type: 'long_sleep',
      total_sleep_duration: 27000, deep_sleep_duration: 5400,
      rem_sleep_duration: 5400, light_sleep_duration: 16200,
      average_heart_rate: 58, lowest_heart_rate: 52,
      bedtime_start: '2026-02-14T23:00:00+00:00',
    }];

    const result = aggregateSleepByDay(sessions);
    const day = result['2026-02-15'];

    expect(day.total_sleep_duration).toBe(27000);
    expect(day.deep_sleep_duration).toBe(5400);
    expect(day.rem_sleep_duration).toBe(5400);
    expect(day.light_sleep_duration).toBe(16200);
    expect(day.average_heart_rate).toBe(58);
    expect(day.lowest_heart_rate).toBe(52);
  });

  test('two long_sleep sessions same night: durations summed, HR from longer session', () => {
    const sessions = [
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: 18000, deep_sleep_duration: 3600,
        rem_sleep_duration: 3600, light_sleep_duration: 10800,
        average_heart_rate: 62, lowest_heart_rate: 56,
        bedtime_start: '2026-02-14T23:00:00+00:00',
      },
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: 9000, deep_sleep_duration: 1800,
        rem_sleep_duration: 1800, light_sleep_duration: 5400,
        average_heart_rate: 55, lowest_heart_rate: 50,
        bedtime_start: '2026-02-15T06:00:00+00:00',
      },
    ];

    const result = aggregateSleepByDay(sessions);
    const day = result['2026-02-15'];

    expect(day.total_sleep_duration).toBe(27000);
    expect(day.deep_sleep_duration).toBe(5400);
    expect(day.rem_sleep_duration).toBe(5400);
    expect(day.light_sleep_duration).toBe(16200);
    // HR from the longer session (first, 18000s)
    expect(day.average_heart_rate).toBe(62);
    expect(day.lowest_heart_rate).toBe(56);
  });

  test('long_sleep + nap (rest type) same day: durations from BOTH summed', () => {
    const sessions = [
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: 25200, deep_sleep_duration: 5000,
        rem_sleep_duration: 5000, light_sleep_duration: 15200,
        average_heart_rate: 58, lowest_heart_rate: 52,
        bedtime_start: '2026-02-14T23:00:00+00:00',
      },
      {
        day: '2026-02-15', type: 'rest',
        total_sleep_duration: 3600, deep_sleep_duration: 600,
        rem_sleep_duration: 600, light_sleep_duration: 2400,
        average_heart_rate: 65, lowest_heart_rate: 60,
        bedtime_start: '2026-02-15T14:00:00+00:00',
      },
    ];

    const result = aggregateSleepByDay(sessions);
    const day = result['2026-02-15'];

    expect(day.total_sleep_duration).toBe(28800);
    expect(day.deep_sleep_duration).toBe(5600);
    expect(day.rem_sleep_duration).toBe(5600);
    expect(day.light_sleep_duration).toBe(17600);
    // HR from the long_sleep session (primary)
    expect(day.average_heart_rate).toBe(58);
    expect(day.lowest_heart_rate).toBe(52);
  });

  test('null deep_sleep_duration treated as 0 when summing', () => {
    const sessions = [
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: 20000, deep_sleep_duration: null,
        rem_sleep_duration: 4000, light_sleep_duration: 16000,
        average_heart_rate: 58, lowest_heart_rate: 52,
        bedtime_start: '2026-02-14T23:00:00+00:00',
      },
      {
        day: '2026-02-15', type: 'rest',
        total_sleep_duration: 3600, deep_sleep_duration: 600,
        rem_sleep_duration: 600, light_sleep_duration: 2400,
        average_heart_rate: 65, lowest_heart_rate: 60,
        bedtime_start: '2026-02-15T14:00:00+00:00',
      },
    ];

    const result = aggregateSleepByDay(sessions);
    const day = result['2026-02-15'];

    expect(day.deep_sleep_duration).toBe(600);
    expect(day.total_sleep_duration).toBe(23600);
  });

  test('three+ sessions same day: all summed correctly', () => {
    const sessions = [
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: 18000, deep_sleep_duration: 3600,
        rem_sleep_duration: 3600, light_sleep_duration: 10800,
        average_heart_rate: 58, lowest_heart_rate: 52,
        bedtime_start: '2026-02-14T22:30:00+00:00',
      },
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: 7200, deep_sleep_duration: 1200,
        rem_sleep_duration: 1200, light_sleep_duration: 4800,
        average_heart_rate: 55, lowest_heart_rate: 50,
        bedtime_start: '2026-02-15T05:00:00+00:00',
      },
      {
        day: '2026-02-15', type: 'rest',
        total_sleep_duration: 2700, deep_sleep_duration: 300,
        rem_sleep_duration: 600, light_sleep_duration: 1800,
        average_heart_rate: 65, lowest_heart_rate: 60,
        bedtime_start: '2026-02-15T14:00:00+00:00',
      },
    ];

    const result = aggregateSleepByDay(sessions);
    const day = result['2026-02-15'];

    expect(day.total_sleep_duration).toBe(27900);
    expect(day.deep_sleep_duration).toBe(5100);
    expect(day.rem_sleep_duration).toBe(5400);
    expect(day.light_sleep_duration).toBe(17400);
    // HR from longest long_sleep (first, 18000s)
    expect(day.average_heart_rate).toBe(58);
    expect(day.lowest_heart_rate).toBe(52);
  });

  test('HR metrics come from longest long_sleep, not summed', () => {
    const sessions = [
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: 10000, deep_sleep_duration: 2000,
        rem_sleep_duration: 2000, light_sleep_duration: 6000,
        average_heart_rate: 70, lowest_heart_rate: 65,
        bedtime_start: '2026-02-15T04:00:00+00:00',
      },
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: 15000, deep_sleep_duration: 3000,
        rem_sleep_duration: 3000, light_sleep_duration: 9000,
        average_heart_rate: 55, lowest_heart_rate: 48,
        bedtime_start: '2026-02-14T22:00:00+00:00',
      },
    ];

    const result = aggregateSleepByDay(sessions);
    const day = result['2026-02-15'];

    // HR from the LONGEST long_sleep (second session, 15000s)
    expect(day.average_heart_rate).toBe(55);
    expect(day.lowest_heart_rate).toBe(48);
    // Durations still summed
    expect(day.deep_sleep_duration).toBe(5000);
  });

  test('sessions on different days are not mixed', () => {
    const sessions = [
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: 25200, deep_sleep_duration: 5000,
        rem_sleep_duration: 5000, light_sleep_duration: 15200,
        average_heart_rate: 58, lowest_heart_rate: 52,
      },
      {
        day: '2026-02-16', type: 'long_sleep',
        total_sleep_duration: 28800, deep_sleep_duration: 6000,
        rem_sleep_duration: 6000, light_sleep_duration: 16800,
        average_heart_rate: 55, lowest_heart_rate: 49,
      },
    ];

    const result = aggregateSleepByDay(sessions);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['2026-02-15'].deep_sleep_duration).toBe(5000);
    expect(result['2026-02-16'].deep_sleep_duration).toBe(6000);
  });

  test('all null durations sum to 0', () => {
    const sessions = [
      {
        day: '2026-02-15', type: 'long_sleep',
        total_sleep_duration: null, deep_sleep_duration: null,
        rem_sleep_duration: null, light_sleep_duration: null,
        average_heart_rate: 58, lowest_heart_rate: 52,
      },
    ];

    const result = aggregateSleepByDay(sessions);
    const day = result['2026-02-15'];

    expect(day.total_sleep_duration).toBe(0);
    expect(day.deep_sleep_duration).toBe(0);
  });

  test('nap only (no long_sleep): nap is the primary', () => {
    const sessions = [{
      day: '2026-02-15', type: 'rest',
      total_sleep_duration: 3600, deep_sleep_duration: 600,
      rem_sleep_duration: 600, light_sleep_duration: 2400,
      average_heart_rate: 65, lowest_heart_rate: 60,
    }];

    const result = aggregateSleepByDay(sessions);
    const day = result['2026-02-15'];

    expect(day.total_sleep_duration).toBe(3600);
    expect(day.average_heart_rate).toBe(65);
    expect(day.type).toBe('rest');
  });

  test('two naps same day: durations summed, HR from longer nap', () => {
    const sessions = [
      {
        day: '2026-02-15', type: 'rest',
        total_sleep_duration: 2400, deep_sleep_duration: 300,
        rem_sleep_duration: 300, light_sleep_duration: 1800,
        average_heart_rate: 62, lowest_heart_rate: 57,
      },
      {
        day: '2026-02-15', type: 'rest',
        total_sleep_duration: 3600, deep_sleep_duration: 600,
        rem_sleep_duration: 600, light_sleep_duration: 2400,
        average_heart_rate: 65, lowest_heart_rate: 60,
      },
    ];

    const result = aggregateSleepByDay(sessions);
    const day = result['2026-02-15'];

    expect(day.total_sleep_duration).toBe(6000);
    expect(day.deep_sleep_duration).toBe(900);
    // HR from longer nap (second, 3600s)
    expect(day.average_heart_rate).toBe(65);
  });
});

test.describe('Sleep Record Conversion', () => {
  test('converts aggregated session to sleep_data record format', () => {
    const aggregated = {
      day: '2026-02-15',
      total_sleep_duration: 27000, deep_sleep_duration: 5400,
      rem_sleep_duration: 5400, light_sleep_duration: 16200,
      average_heart_rate: 58, lowest_heart_rate: 52,
      bedtime_start: '2026-02-14T23:00:00+00:00',
    };

    const record = toSleepRecord(aggregated, 'user-123', { '2026-02-15': 85 });

    expect(record.user_id).toBe('user-123');
    expect(record.date).toBe('2026-02-15');
    expect(record.total_sleep_minutes).toBe(450);
    expect(record.deep_sleep_minutes).toBe(90);
    expect(record.rem_sleep_minutes).toBe(90);
    expect(record.light_sleep_minutes).toBe(270);
    expect(record.sleep_score).toBe(85);
    expect(record.avg_hr).toBe(58);
    expect(record.pre_sleep_hr).toBe(52);
  });

  test('handles missing sleep score', () => {
    const aggregated = {
      day: '2026-02-15', total_sleep_duration: 27000,
      deep_sleep_duration: 5400, rem_sleep_duration: 5400,
      light_sleep_duration: 16200, average_heart_rate: 58,
      lowest_heart_rate: 52, bedtime_start: null,
    };

    const record = toSleepRecord(aggregated, 'user-123', {});
    expect(record.sleep_score).toBeNull();
  });

  test('handles null HR metrics', () => {
    const aggregated = {
      day: '2026-02-15', total_sleep_duration: 27000,
      deep_sleep_duration: 5400, rem_sleep_duration: 5400,
      light_sleep_duration: 16200, average_heart_rate: null,
      lowest_heart_rate: null, bedtime_start: null,
    };

    const record = toSleepRecord(aggregated, 'user-123');
    expect(record.avg_hr).toBeNull();
    expect(record.pre_sleep_hr).toBeNull();
  });

  test('rounds fractional minutes correctly', () => {
    const aggregated = {
      day: '2026-02-15',
      total_sleep_duration: 27050, deep_sleep_duration: 5430,
      rem_sleep_duration: 5370, light_sleep_duration: 16250,
      average_heart_rate: 58, lowest_heart_rate: 52,
    };

    const record = toSleepRecord(aggregated, 'user-123');
    expect(record.total_sleep_minutes).toBe(Math.round(27050 / 60));
    expect(record.deep_sleep_minutes).toBe(Math.round(5430 / 60));
  });
});

test.describe('Webhook Endpoint (Integration)', () => {
  test('rejects unauthenticated requests', async ({ request }) => {
    const response = await request.post('http://localhost:3000/webhook/sync-sleep', {
      data: { userId: 'test-user', ouraToken: 'test-token' },
    });
    expect(response.status()).toBe(401);
  });

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get('http://localhost:3000/health');
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data.status).toBe('ok');
  });
});
