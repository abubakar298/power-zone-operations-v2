import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Each spec gets a fresh disposable database. This preserves production-strength
// authentication throttling rather than disabling it for a growing browser suite.
const specs = readdirSync(new URL("../tests/browser/", import.meta.url))
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();
if (!specs.length) throw new Error("No browser test specifications found.");
for (const spec of specs) {
  const result = spawnSync("pnpm", ["exec", "playwright", "test", spec], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
