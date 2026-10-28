import { defineConfig } from "@playwright/test";

const port = process.env.PZ_E2E_PORT ?? "3180";
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  retries: 0,
  timeout: 150000,
  use: {
    actionTimeout: 10000,
    baseURL: origin,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      `mkdir -p .local && ${process.env.PZ_E2E_PREBUILT === "1" ? "" : "pnpm build && "}node --import tsx tests/e2e-server.ts`,
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});
