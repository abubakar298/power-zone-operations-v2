import { spawn } from "node:child_process";
import { once } from "node:events";
import { testDatabase } from "./database.js";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const db = await testDatabase();
const port = process.env.PZ_E2E_PORT ?? "3180";
const origin = `http://127.0.0.1:${port}`;
const fixturePath = `.local/e2e-fixture-${port}.json`;
const env = {
  ...process.env,
  NODE_ENV: "test",
  PORT: port,
  APP_ORIGIN: origin,
  DATABASE_URL: db.url,
  ADMIN_SETUP_TOKEN: "browser-test-setup-key-isolated-only",
};
let app: ReturnType<typeof spawn>;
// Express intentionally rejects hidden path segments. The release rehearsal can
// live beneath .rehearsal, so serve its identical built assets from a temp path.
const assetRoot = await mkdtemp(join(tmpdir(), "pz-browser-assets-"));
await cp(resolve("dist/web"), join(assetRoot, "dist/web"), { recursive: true });
const serverEntry = resolve("dist/server/main.js");
async function startApp() {
  app = spawn(process.execPath, [serverEntry], {
    cwd: assetRoot,
    env,
    stdio: "inherit",
  });
  for (let i = 0; i < 100; i++) {
    if (app.exitCode !== null) throw new Error("Test API process exited");
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test API did not become healthy");
}
await startApp();
// Private harness metadata only. Tests never accept DATABASE_URL or grant staff
// access through an application endpoint or a production database connection.
await import("node:fs/promises").then(async (fs) => {
  await fs.writeFile(fixturePath, JSON.stringify({
    marker: "power-zone-disposable-browser-fixture-v1",
    pid: process.pid,
    databaseUrl: db.url,
  }), { mode: 0o600 });
  await fs.chmod(fixturePath, 0o600);
});
let restarting = false;
let generation = 0;
process.on("SIGUSR2", () => {
  if (restarting) return;
  restarting = true;
  void (async () => {
    const exited = once(app, "exit");
    app.kill("SIGTERM");
    await exited;
    await startApp();
    generation++;
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(
        `.local/e2e-control-${port}.json`,
        JSON.stringify({ pid: process.pid, generation }),
      ),
    );
    restarting = false;
  })().catch(() => {
    console.error("Test restart failed.");
    process.exit(1);
  });
});
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  if (app.exitCode === null) {
    const exited = once(app, "exit");
    app.kill("SIGTERM");
    await exited;
  }
  await db.close();
  await rm(assetRoot, { recursive: true, force: true });
  await import("node:fs/promises").then((fs) => fs.rm(fixturePath, { force: true }));
  process.exit(0);
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
// Browser test can request a restart without a production HTTP backdoor.
await import("node:fs/promises").then((fs) =>
  fs.writeFile(
    `.local/e2e-control-${port}.json`,
    JSON.stringify({ pid: process.pid, generation }),
  ),
);
