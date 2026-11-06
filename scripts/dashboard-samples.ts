import pg from "pg";
import { readFile } from "node:fs/promises";
import { createDashboardSamples } from "../server/coordinator/samples.js";

// Explicit operator action; no deployment hook or public endpoint. Connection
// secrets come from environment or a private file and are never printed.
const url =
  process.env.DATABASE_URL ??
  (process.env.SAMPLE_DATABASE_FILE
    ? (await readFile(process.env.SAMPLE_DATABASE_FILE, "utf8")).trim()
    : "");
if (!url) throw new Error("Set DATABASE_URL or SAMPLE_DATABASE_FILE.");
const pool = new pg.Pool({
  connectionString: url,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined,
});
try {
  const owner = (
    await pool.query(
      "SELECT id FROM users WHERE lower(email)='bess@powerzone.com.pk' AND active AND role='Coordinator'",
    )
  ).rows[0];
  const reviewer = (
    await pool.query(
      "SELECT id FROM users WHERE active AND role IN('Admin','Management') ORDER BY created_at LIMIT 1",
    )
  ).rows[0];
  if (!owner || !reviewer)
    throw new Error("Atif and management accounts must exist first.");
  const records = await createDashboardSamples(pool, owner.id, reviewer.id);
  console.log(
    `Training batch ready: ${records.length} sample proposals for Atif. Existing records preserved.`,
  );
} finally {
  await pool.end();
}
