const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  projects: [
    {
      name: 'Desktop Chrome',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3000',
        headless: true,
        launchOptions: { slowMo: 500 },
      },
    },
    {
      name: 'Mobile Safari',
      use: {
        ...devices['iPhone 14'],
        baseURL: 'http://localhost:3000',
        headless: true,
        launchOptions: { slowMo: 500 },
      },
    },
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 7'],
        baseURL: 'http://localhost:3000',
        headless: true,
        launchOptions: { slowMo: 500 },
      },
    },
  ],
  webServer: {
    command: 'WEBHOOK_SECRET=test-webhook-secret node server.js',
    port: 3000,
    reuseExistingServer: true,
    env: {
      WEBHOOK_SECRET: 'test-webhook-secret',
    },
  },
});
