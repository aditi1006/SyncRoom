import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build served by the Node server.
 * Run `npm run build` first, then `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Fake camera/microphone so getUserMedia succeeds headlessly.
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
        permissions: ['camera', 'microphone'],
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
            'media.autoplay.default': 0,
            'media.autoplay.blocking_policy': 0,
          },
        },
      },
    },
    {
      // Microsoft Edge, same engine, real-world channel. Skipped
      // automatically on machines without Edge installed.
      name: 'msedge',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
        permissions: ['camera', 'microphone'],
      },
    },
  ],
  webServer: {
    command: 'node server/dist/index.js',
    port: 3100,
    env: { PORT: '3100', CLIENT_ORIGIN: 'http://localhost:3100' },
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
