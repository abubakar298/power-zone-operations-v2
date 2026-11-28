// READ-ONLY diagnosis. Owner request, 27 November 2026: UBL OPF Housing Society Branch (1344), IPO CHP-163,
// shows customer PO POF262715099; the bank's active PO is POF262715043. This prints every row that holds either
// number (and POF262715042) and checks whether the "Attach customer PO" flow can be used for this site.
// It changes nothing: the whole run is one READ ONLY transaction that is rolled back.
import pg from "pg";

const numbers = ["POF262715099", "POF262715043", "POF262715042"];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const c = await pool.connect();
const show = (title, rows) => { console.log(`\n=== ${title} (${rows.length}) ===`); for (const r of rows) console.log(JSON.stringify(r)); };
try {
  await c.query("BEGIN READ ONLY");
  await c.query("SET LOCAL statement_timeout='120s'");

  const records = (await c.query(
    `SELECT r.id,r.site_name,r.site_code,r.region,r.stage,r.version,r.route,u.display_name AS coordinator,
       r.data->>'ipoId' AS ipo_id,r.data#>>'{basis,order,input,evidenceType}' AS evidence_type,
       r.data->'latePo' IS NOT NULL AS has_late_po
     FROM project_workflow_records r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.coordinator_id
     WHERE lower(c.short_code)='ubl' AND (r.site_code='1344' OR r.site_name ILIKE '%OPF HOUSING%')
     ORDER BY r.created_at`)).rows;
  show("UBL workflow records for branch 1344 / OPF Housing", records);

  for (const r of records) {
    show(`Issued IPO and PO receipt shown on IPOs Shared — record ${r.id}`, (await c.query(
      `SELECT i.record_id,q.id AS ipo_id,q.number AS ipo_number,q.snapshot#>>'{input,orderNumber}' AS order_no,
         q.snapshot->'input'->>'evidenceType' AS ipo_evidence_type,q.snapshot->'historicalImport' IS NOT NULL
           AND q.snapshot->'historicalImport'<>'false'::jsonb AS historical_import,
         p.id AS receipt_id,p.version AS receipt_version,p.reference AS po_reference,p.input->>'date' AS po_date,i.created_at
       FROM project_workflow_issuances i JOIN internal_purchase_orders q ON q.id=i.ipo_id
       JOIN project_po_receipts p ON p.id=i.receipt_id WHERE i.record_id=$1`, [r.id])).rows);
    show(`All IPOs (original and revisions) — record ${r.id}`, (await c.query(
      `SELECT id,number,created_at,customer_po_id FROM internal_purchase_orders WHERE id::text=$2 OR snapshot->>'workflowRecordId'=$1 ORDER BY created_at`,
      [r.id, r.ipo_id ?? ""])).rows);
    show(`Files attached to record ${r.id} (no content)`, (await c.query(
      `SELECT f.id,f.kind,f.filename,f.mime,octet_length(f.content) AS bytes,u.display_name AS by,f.created_at
       FROM project_workflow_files f LEFT JOIN users u ON u.id=f.created_by WHERE f.record_id=$1 ORDER BY f.created_at`, [r.id])).rows);
    show(`Customer PO received-later rows — record ${r.id}`, (await c.query(
      `SELECT id,version,po_number,po_date,file_id,created_at FROM project_late_customer_pos WHERE record_id=$1 ORDER BY version`, [r.id])).rows);
  }

  // Would POF262715043 be refused as "already belongs to another site"?
  const recordIds = records.map((r) => r.id);
  show("POF262715043 already used by another site? (must be empty)", (await c.query(
    `SELECT 'project_po_receipts' AS t,record_id::text AS record_id,reference AS po FROM project_po_receipts WHERE lower(reference)='pof262715043' AND NOT (record_id=ANY($1::uuid[]))
     UNION ALL SELECT 'project_late_customer_pos',record_id::text,po_number FROM project_late_customer_pos WHERE lower(po_number)='pof262715043' AND NOT (record_id=ANY($1::uuid[]))
     UNION ALL SELECT 'customer_purchase_orders',id::text,po_number FROM customer_purchase_orders WHERE lower(po_number)='pof262715043'`,
    [recordIds])).rows);

  // Every row in any table whose text/json columns mention one of the three PO numbers.
  const cols = (await c.query(
    `SELECT c.table_name,c.column_name FROM information_schema.columns c JOIN information_schema.tables t
       ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
     WHERE c.table_schema='public' AND c.data_type IN('text','character varying','jsonb','json') ORDER BY 1,2`)).rows;
  const byTable = new Map();
  for (const { table_name, column_name } of cols) byTable.set(table_name, [...(byTable.get(table_name) ?? []), column_name]);
  const pattern = numbers.join("|");
  for (const [table, columns] of byTable) {
    const hasId = (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='id'`, [table])).rowCount;
    const where = columns.map((col) => `${JSON.stringify(col)}::text ~* $1`).join(" OR ");
    const rows = (await c.query(
      `SELECT ${hasId ? "id::text AS id," : "ctid::text AS id,"} ${columns.map((col) => `CASE WHEN ${JSON.stringify(col)}::text ~* $1 THEN substring(${JSON.stringify(col)}::text from '(?i)(POF2627150(?:99|43|42))') END AS ${JSON.stringify(col)}`).join(",")}
       FROM ${JSON.stringify(table)} WHERE ${where} LIMIT 50`, [pattern])).rows;
    if (rows.length) show(`Table ${table}: rows mentioning ${numbers.join(" / ")}`, rows.map((row) => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null))));
  }
  console.log("\nDone. Nothing was changed (read-only transaction).");
} finally {
  await c.query("ROLLBACK").catch(() => {});
  c.release();
  await pool.end();
}
