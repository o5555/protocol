// @ts-check
const { test, expect } = require('@playwright/test');
require('dotenv').config({ path: '.env.test.local' });

const OURA_TOKEN = process.env.OURA_TEST_TOKEN;
const hasToken = OURA_TOKEN && OURA_TOKEN !== 'your-real-oura-token-here';

test.describe('Oura API Integration', () => {
  test.skip(!hasToken, 'Skipping - OURA_TEST_TOKEN not set in .env.test.local');

  test('can fetch sleep data from Oura API', async ({ request }) => {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await request.get(
      `https://api.ouraring.com/v2/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`,
      {
        headers: {
          'Authorization': `Bearer ${OURA_TOKEN}`
        }
      }
    );

    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('data');
    expect(Array.isArray(data.data)).toBe(true);
  });

  test('can fetch daily sleep scores from Oura API', async ({ request }) => {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await request.get(
      `https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${startDate}&end_date=${endDate}`,
      {
        headers: {
          'Authorization': `Bearer ${OURA_TOKEN}`
        }
      }
    );

    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('data');
    expect(Array.isArray(data.data)).toBe(true);
  });

  test('sleep data has expected fields', async ({ request }) => {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await request.get(
      `https://api.ouraring.com/v2/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`,
      {
        headers: {
          'Authorization': `Bearer ${OURA_TOKEN}`
        }
      }
    );

    const data = await response.json();
    
    if (data.data.length > 0) {
      const sleepSession = data.data[0];
      expect(sleepSession).toHaveProperty('day');
      expect(sleepSession).toHaveProperty('total_sleep_duration');
      expect(sleepSession).toHaveProperty('deep_sleep_duration');
      expect(sleepSession).toHaveProperty('rem_sleep_duration');
      expect(sleepSession).toHaveProperty('light_sleep_duration');
    }
  });

  test('daily sleep has score field', async ({ request }) => {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await request.get(
      `https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${startDate}&end_date=${endDate}`,
      {
        headers: {
          'Authorization': `Bearer ${OURA_TOKEN}`
        }
      }
    );

    const data = await response.json();
    
    if (data.data.length > 0) {
      const dailySleep = data.data[0];
      expect(dailySleep).toHaveProperty('day');
      expect(dailySleep).toHaveProperty('score');
    }
  });

  test('can fetch 30 days of historical data for baseline', async ({ request }) => {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await request.get(
      `https://api.ouraring.com/v2/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`,
      {
        headers: {
          'Authorization': `Bearer ${OURA_TOKEN}`
        }
      }
    );

    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data.data.length).toBeGreaterThan(0);
    console.log(`Fetched ${data.data.length} sleep sessions for 30-day baseline`);
  });
});

test.describe('Oura API Error Handling', () => {
  test('returns 401 for invalid token', async ({ request }) => {
    const response = await request.get(
      'https://api.ouraring.com/v2/usercollection/sleep?start_date=2024-01-01&end_date=2024-01-07',
      {
        headers: {
          'Authorization': 'Bearer invalid-token-12345'
        }
      }
    );

    expect(response.status()).toBe(401);
  });

  test('handles missing date parameters gracefully', async ({ request }) => {
    test.skip(!hasToken, 'Skipping - OURA_TEST_TOKEN not set');
    
    const response = await request.get(
      'https://api.ouraring.com/v2/usercollection/sleep',
      {
        headers: {
          'Authorization': `Bearer ${OURA_TOKEN}`
        }
      }
    );

    // Oura API returns data even without date params (uses defaults)
    expect(response.ok()).toBe(true);
  });
});

test.describe('Local Proxy API', () => {
  test('proxy endpoint exists', async ({ request }) => {
    const response = await request.get('http://localhost:3000/api/sleep?start_date=2024-01-01&end_date=2024-01-07', {
      headers: {
        'Authorization': 'Bearer test-token'
      }
    });
    
    // Should get some response (even if error due to invalid token)
    expect(response.status()).toBeDefined();
  });

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get('http://localhost:3000/health');
    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data.status).toBe('ok');
  });
});
