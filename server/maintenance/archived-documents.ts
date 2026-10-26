import type {Pool} from 'pg';

export async function archivedDocumentIds(pool: Pool): Promise<Set<string>> {
  const rows=(await pool.query("SELECT jsonb_array_elements_text(records->'localPreviewDocumentIds') AS id FROM test_workflow_archives WHERE key LIKE 'LOCAL-REVIEW-SAMPLES-%'")).rows;
  return new Set(rows.map(row=>row.id));
}
