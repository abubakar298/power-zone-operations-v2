import type { PoolClient } from "pg";
// Existing business tables are never rewritten by the Design/Coordination release.
export const protectedReleaseTables = [
  "document_sequences",
  "document_site_identities",
  "document_reference_roots",
  "customers",
  "sites",
  "brands",
  "brand_versions",
  "item_master",
  "rate_versions",
  "rule_versions",
  "specification_versions",
  "item_spec_versions",
  "inventory_catalogue_versions",
  "inventory_item_aliases",
  "engineering_profile_versions",
  "customer_order_reference_history",
  "ubl_commercial_history",
  "ubl_cost_revisions",
  "ubl_technical_versions",
  "ubl_site_orders",
  "ubl_site_budget_revisions",
  "ubl_workflow_requests",
  "ubl_site_document_versions",
  "ubl_site_price_revisions",
  "project_source_imports",
  "project_source_links",
  "project_checkpoint_versions",
  "accounts_job_closures",
  "accounts_ipo_reviews",
  "inventory_reports",
  "inventory_report_versions",
  "inventory_report_files",
  "survey_uploads",
  "boq_revisions",
  "commercial_pricing_versions",
  "quotation_versions",
  "customer_purchase_orders",
  "internal_purchase_orders",
  "operations_boq_issuances",
  "document_commercial_contract_versions",
];
type PreservationState = Record<
  string,
  { count: string; digest: string; columns: string[] }
>;
export async function preservationSnapshot(
  client: PoolClient,
  lock = false,
  baseline?: PreservationState,
) {
  const result: PreservationState = {};
  for (const name of protectedReleaseTables) {
    if (
      !(
        await client.query("SELECT to_regclass($1) AS name", [`public.${name}`])
      ).rows[0].name
    )
      continue;
    if (lock)
      await client.query(`LOCK TABLE "${name}" IN SHARE ROW EXCLUSIVE MODE`);
    const currentColumns = (
      await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
        [name],
      )
    ).rows.map((row) => String(row.column_name));
    const columns = baseline?.[name]?.columns ?? currentColumns;
    if (columns.some((column) => !currentColumns.includes(column)))
      throw Error(`Protected ${name} column would be removed.`);
    const added = currentColumns.filter((column) => !columns.includes(column));
    const values = (
      await client.query(
        `SELECT count(*)::text AS count,md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) AS digest FROM (SELECT md5((to_jsonb(t)-$1::text[])::text) AS row_hash FROM "${name}" t) rows`,
        [added],
      )
    ).rows[0];
    result[name] = { ...values, columns };
  }
  return result;
}
export function requirePreserved(
  before: Awaited<ReturnType<typeof preservationSnapshot>>,
  after: Awaited<ReturnType<typeof preservationSnapshot>>,
  migration: string,
) {
  for (const [table, baseline] of Object.entries(before)) {
    if (JSON.stringify(baseline) !== JSON.stringify(after[table]))
      throw new Error(
        `Preservation guard stopped ${migration}: protected ${table} would change. No changes from this migration were committed.`,
      );
  }
}
