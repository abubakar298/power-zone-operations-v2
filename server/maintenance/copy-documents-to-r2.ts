// Copy stored files from the database to Cloudflare R2 (R2 rollout steps 1 and 3).
// Run in Render -> web service -> Shell. Reads DATABASE_URL and the R2_* settings
// from the environment; never prints keys.
//
//   node dist/server/maintenance/copy-documents-to-r2.js --check   test the R2 keys (writes one tiny file under checks/)
//   node dist/server/maintenance/copy-documents-to-r2.js           dry run: what is still to copy (changes nothing)
//   node dist/server/maintenance/copy-documents-to-r2.js --apply [--limit 200]
//
// --apply copies files that are not copied yet, reads each one back and checks
// its sha256, then records it in document_object_copies. It never changes or
// deletes anything in the database. Safe to stop and run again: it carries on
// where it stopped.
import { randomUUID } from "node:crypto";
import { readConfig, readR2Config } from "../config.js";
import { createPool } from "../db/pool.js";
import { R2Store, sha256Hex } from "../documents/r2-store.js";
import { copyPending, pendingSummary } from "../documents/object-copies.js";

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
if (!(limit > 0)) throw new Error("--limit needs a positive number");

const store = new R2Store(readR2Config(process.env));
const megabytes = (bytes: number) => (bytes / 1048576).toFixed(1) + " MB";

if (args.includes("--check")) {
  const key = `checks/${new Date().toISOString().slice(0, 10)}-${randomUUID()}.txt`;
  const body = Buffer.from("Power Zone R2 connection check\n");
  await store.put(key, body, "text/plain");
  const back = await store.get(key);
  if (!back || sha256Hex(back) !== sha256Hex(body))
    throw new Error("R2 check failed: the test file did not read back correctly");
  console.log("R2 check passed: wrote and read back", key);
} else {
  const pool = createPool(readConfig());
  try {
    const print = async (title: string) => {
      const rows = await pendingSummary(pool);
      console.log(title);
      for (const r of rows)
        if (r.files)
          console.log(" ", `${r.table}.${r.column}`.padEnd(45), String(r.files).padStart(6), "files", megabytes(r.bytes).padStart(10));
      const files = rows.reduce((n, r) => n + r.files, 0);
      const bytes = rows.reduce((n, r) => n + r.bytes, 0);
      console.log("  Total still to copy:", files, "files,", megabytes(bytes));
    };
    await print("Files not yet copied to R2:");
    if (!args.includes("--apply")) {
      console.log("Dry run only. Nothing was copied. Add --apply to copy.");
    } else {
      const failed = new Set<string>();
      let copied = 0, bytes = 0;
      while (copied < limit) {
        const result = await copyPending(pool, store, {
          limit: Math.min(25, limit - copied),
          skip: (id) => failed.has(id),
          log: (line) => console.log(JSON.stringify(line)),
        });
        copied += result.copied;
        bytes += result.bytes;
        for (const f of result.failed) failed.add(f.id);
        // Failed files are skipped on the next round; stop once nothing is left to try.
        if (result.copied === 0 && result.failed.length === 0) break;
      }
      console.log(`Copied ${copied} files (${megabytes(bytes)}). Failed: ${failed.size}.`);
      await print("After this run:");
      if (failed.size) process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}
