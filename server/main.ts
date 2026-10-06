import { AccountsRepository } from "./onboarding/repository.js";
import { ResendDelivery } from "./email/delivery.js";
import { resolve } from "node:path";
import { readConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { createApp } from "./app.js";
import { AuthRepository } from "./auth/repository.js";
import { runRequestedDashboardSamples } from "./coordinator/samples.js";

const config = readConfig();
const pool = createPool(config);
pool.on("error", () => console.error("Database connection interrupted."));
// Only an explicit operator setting enables the owner-requested training batch.
// Normal deployments never create sample records. Batch retries are idempotent.
if (process.env.PZ_DASHBOARD_SAMPLE_BATCH === "atif-training-20-v1") {
  await runRequestedDashboardSamples(
    pool,
    process.env.PZ_DASHBOARD_SAMPLE_BATCH,
  );
  console.log("Atif dashboard training batch ready: 20 sample proposals.");
}
const app = createApp(pool, config, resolve("dist/web"));
const server = app.listen(config.port, "0.0.0.0", () =>
  console.log(`Power Zone V2 listening on port ${config.port}`),
);
const repository = new AuthRepository(pool);
const cleanup = setInterval(
  () => {
    void repository
      .cleanup()
      .catch(() => console.error("Session cleanup failed."));
  },
  15 * 60 * 1000,
);
cleanup.unref();
const accounts = new AccountsRepository(pool),
  delivery = new ResendDelivery(config);
let delivering = false;
const emails = setInterval(() => {
  if (delivering || !delivery.configured) return;
  delivering = true;
  void accounts
    .cleanup()
    .then(() => accounts.deliverOne(delivery, config.emailEncryptionKey!))
    .catch(() => console.error("Email processing interrupted."))
    .finally(() => {
      delivering = false;
    });
}, 5000);
emails.unref();
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(cleanup);
  clearInterval(emails);
  const timeout = setTimeout(() => {
    console.error("Shutdown timed out.");
    process.exit(1);
  }, 10000).unref();
  server.close(() => {
    void pool.end().finally(() => {
      clearTimeout(timeout);
    });
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
