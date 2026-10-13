import { readConfig } from "../config.js";
import { createPool } from "./pool.js";
import { migrate } from "./migrate.js";

const pool = createPool(readConfig());
try {
  const ledgerExists=(await pool.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name;
  const established=ledgerExists&&((await pool.query("SELECT 1 FROM schema_migrations WHERE name='058_document_commercial_contract.sql'")).rowCount??0)>0;
  await migrate(pool, undefined, !!established || process.env.NODE_ENV === "production");
  console.log("Database migrations are up to date.");
} catch {
  console.error(
    "Database migration failed. Check database access and migration history.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
