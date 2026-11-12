import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Each spec gets a fresh disposable database. This preserves production-strength
// authentication throttling rather than disabling it for a growing browser suite.
const allSpecs = readdirSync(new URL("../tests/browser/", import.meta.url))
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();
if (!allSpecs.length) throw new Error("No browser test specifications found.");
// CI may split the specs across machines with PZ_E2E_SHARD="part/total" (e.g. "1/2").
// Without it, every spec runs, as before.
const shard = /^([1-9]\d*)\/([1-9]\d*)$/.exec(process.env.PZ_E2E_SHARD ?? "");
if (process.env.PZ_E2E_SHARD && (!shard || Number(shard[1]) > Number(shard[2])))
  throw new Error("PZ_E2E_SHARD must look like 1/2.");
const specs = shard
  ? allSpecs.filter((_, index) => index % Number(shard[2]) === Number(shard[1]) - 1)
  : allSpecs;
// Every spec uses the same source assets; only its disposable database changes.
const build = spawnSync("pnpm", ["build"], { stdio: "inherit", env: process.env });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
for (const spec of specs) {
  const result = spawnSync("pnpm", ["exec", "playwright", "test", spec], {
    stdio: "inherit",
    env: { ...process.env, PZ_E2E_PREBUILT: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
