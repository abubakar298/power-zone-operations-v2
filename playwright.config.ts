import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', workers: 1, retries: 0, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:3180', trace: 'retain-on-failure' },
  webServer: {
    command: 'mkdir -p .local && pnpm build && pnpm exec tsx tests/e2e-server.ts',
    url: 'http://127.0.0.1:3180/api/health', reuseExistingServer: false, timeout: 120000,
    gracefulShutdown: {signal:'SIGTERM',timeout:10000},
  },
});
