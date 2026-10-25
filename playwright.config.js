import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 20000,
  use: {
    baseURL: 'http://127.0.0.1:4317',
    headless: true,
    launchOptions: {
      executablePath: process.env.GUIDEME_CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
    }
  },
  webServer: {
    command: 'node tests/fixtures/server.js',
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: !process.env.CI
  }
});
