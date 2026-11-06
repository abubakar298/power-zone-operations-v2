import type { Pool } from "pg";

export const testArchiveKey = "owner-confirmed-test-workflow-2026-10-07";
// Each owner-authorized cleanup has a separate immutable key and fixed cutoff.
// Never roll an existing cutoff forward or reuse its key for another batch.
export const completedSampleArchiveKey =
  "owner-confirmed-completed-samples-2026-10-07-115531";
const requests: Record<string, string> = {
  "owner-confirmed-all-samples-2026-10-08-171813": "2026-10-08T17:18:13Z",
  [testArchiveKey]: "2026-10-07T06:52:51Z",
  [completedSampleArchiveKey]: "2026-10-07T11:55:31Z",
};
const tables = [
  "cni_proposal_actions",
  "cni_proposal_versions",
  "cni_proposals",
  "external_document_approval_files",
  "external_document_approvals",
  "design_survey_handoffs",
  "design_surveys",
  "ipo_accounts_handoffs",
  "department_checkpoints",
  "store_boq_issuances",
  "operations_stock_demand",
  "operations_delivery_plans",
  "operations_boq_issuances",
  "internal_purchase_orders",
  "customer_purchase_orders",
  "ipo_submissions",
  "customer_po_documents",
  "coordination_events",
  "quotation_revision_links",
  "quotation_revision_requests",
  "quotation_additional_inputs",
  "quotation_versions",
  "commercial_pricing_versions",
  "costing_approval_evidence",
  "costing_approval_instructions",
  "boq_uploads",
  "boq_draft_finalizations",
  "boq_review_decisions",
  "boq_review_submissions",
  "boq_revisions",
  "boqs",
  "survey_drafts",
  "survey_uploads",
] as const;

/** No HTTP route. Requires an exact operator setting, one transaction and a backup.
 * The owner confirmed all existing workflow documents are disposable test data.
 * Master data, customers, sites, sessions, users, audit history and batch registry
 * are deliberately outside this allowlist. Newer documents make it fail closed.
 */
export async function archiveConfirmedTestWorkflow(
  pool: Pool,
  requested?: string,
) {
  const cutoff = requested && requests[requested];
  if (!requested || !cutoff) return;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout = '10s'");
    await c.query("SELECT pg_advisory_xact_lock(742019021)");
    const existing = (
      await c.query("SELECT counts FROM test_workflow_archives WHERE key=$1", [
        requested,
      ])
    ).rows[0];
    if (existing) {
      await c.query("COMMIT");
      return existing.counts;
    }
    // PostgreSQL requires even empty referencing tables in a TRUNCATE set.
    // Later schema additions are safe only when empty: never CASCADE into
    // unrelated live workflow data, even when its root is in this old allowlist.
    const dependencies = (await c.query(`WITH RECURSIVE linked(oid) AS (
      SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])
      UNION SELECT f.conrelid FROM pg_constraint f JOIN linked l ON f.confrelid=l.oid WHERE f.contype='f'
    ) SELECT c.relname,n.nspname FROM linked l JOIN pg_class c ON c.oid=l.oid JOIN pg_namespace n ON n.oid=c.relnamespace ORDER BY c.relname`, [[...tables]])).rows;
    if (dependencies.some(r => r.nspname !== "public"))
      throw new Error("Test cleanup stopped: a dependency is outside the approved schema.");
    const quoted = (name:string) => '"'+name.replaceAll('"','""')+'"';
    const lockedTables = dependencies.map(r => String(r.relname));
    await c.query(`LOCK TABLE ${lockedTables.map(quoted).join(",")} IN ACCESS EXCLUSIVE MODE`);
    for (const table of lockedTables.filter(t => !(tables as readonly string[]).includes(t))) {
      if ((await c.query(`SELECT 1 FROM ${quoted(table)} LIMIT 1`)).rowCount)
        throw new Error(`Test cleanup stopped: unapproved dependent table ${table} contains data. No records were removed.`);
    }
    const records: Record<string, unknown[]> = {},
      counts: Record<string, number> = {};
    for (const table of tables) {
      // All document roots/versions have created_at. Child link rows are covered
      // by their locked roots and are archived in the same transaction.
      const timestamped = (
        await c.query(
          "SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name='created_at'",
          [table],
        )
      ).rowCount;
      if (
        timestamped &&
        (
          await c.query(
            `SELECT 1 FROM ${table} WHERE created_at > $1 LIMIT 1`,
            [cutoff],
          )
        ).rowCount
      )
        throw new Error(
          `Test cleanup stopped: ${table} contains a document newer than the confirmed test cutoff.`,
        );
      const rows = (
        await c.query(`SELECT to_jsonb(t) AS record FROM ${table} t`)
      ).rows.map((r) => r.record);
      records[table] = rows;
      counts[table] = rows.length;
    }
    await c.query(
      "INSERT INTO test_workflow_archives(key,cutoff,counts,records) VALUES($1,$2,$3,$4)",
      [requested, cutoff, counts, records],
    );
    // Only archived allowlisted data and verified-empty dependencies. No CASCADE.
    await c.query(`TRUNCATE TABLE ${lockedTables.map(quoted).join(",")}`);
    await c.query("COMMIT");
    return counts;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
