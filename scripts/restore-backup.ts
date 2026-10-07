import pg from "pg";
import { restoreBackup } from "../server/backups/archive.js";
const [path] = process.argv.slice(2);
const passphrase = process.env.PZ_BACKUP_PASSPHRASE;
const target = process.env.PZ_RESTORE_DATABASE_URL;
if (
  !path ||
  !passphrase ||
  !target ||
  process.env.PZ_RESTORE_CONFIRM_EMPTY !== "restore-to-separate-empty-database"
)
  throw new Error(
    "Provide archive path, PZ_BACKUP_PASSPHRASE, PZ_RESTORE_DATABASE_URL and the documented empty-target confirmation.",
  );
const pool = new pg.Pool({
  connectionString: target,
  max: 2,
  ssl:
    process.env.PZ_RESTORE_TLS === "true"
      ? { rejectUnauthorized: true }
      : false,
});
try {
  console.log(await restoreBackup(pool, path, passphrase));
} catch {
  console.error(
    "Restore failed. Check passphrase, matching release migrations and separate empty target.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
