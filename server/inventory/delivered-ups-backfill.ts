import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { HttpError } from "../http/errors.js";
import { importPendingIpo } from "./pending-ipo-import.js";

const confirmed = [
  { siteId: "registered-MBL:CHP-338:60-site order:15/60", frameworkKey: "MBL-UPS-6-5" },
  ...["20", "73", "98", "153", "167", "180", "182", "185"].map(order => ({
    siteId: "registered-UBL:UPS:" + order + "/250", frameworkKey: "UBL-UPS-6-10",
  })),
];

/** Operator batch for the nine reviewed branches. Default execution rolls back. */
export async function backfillDeliveredUpsIpos(pool: Pool, actor: string, commit = false) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='10s'");
    await c.query("SET LOCAL statement_timeout='30s'");
    // Match the importer/synchronizer lock order before taking any site locks.
    await c.query("SELECT pg_advisory_xact_lock(742019004)");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('historical.pending.ipo.import',0))");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.import',0))");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('material.source.links',0))");
    const source = (await c.query("SELECT version FROM accounts_source_registers ORDER BY version DESC LIMIT 1")).rows[0];
    if (!source) throw new HttpError(409, "The reviewed Accounts source register is unavailable.");
    const results = [];
    for (const { siteId, frameworkKey } of confirmed) {
      const framework = (await c.query("SELECT id FROM project_framework_current WHERE configuration_key=$1", [frameworkKey])).rows[0];
      const board = (await c.query("SELECT version FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1", [siteId])).rows[0];
      if (!framework || !board) throw new HttpError(409, "Approved framework or historical site is unavailable for " + siteId);
      try {
        const result = await importPendingIpo(pool, actor, {
          boardSiteId: siteId, boardVersion: board.version, sourceVersion: source.version, frameworkId: framework.id,
          requestKey: randomUUID(), alreadyDelivered: true,
          reason: "Historical entry prepared by M. Rafiq. Management confirmed the exact imported UPS order was already delivered and its PT record must be retained.",
        }, c);
        results.push({ siteId, ...result });
      } catch (error) {
        throw new HttpError(409, siteId + " · " + (error instanceof Error ? error.message : String(error)));
      }
    }
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return { committed: commit, results };
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
