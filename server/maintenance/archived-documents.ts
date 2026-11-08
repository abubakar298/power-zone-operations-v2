import type {Pool} from 'pg';

export async function archivedDocumentIds(pool: Pool): Promise<Set<string>> {
  const rows=(await pool.query("SELECT jsonb_array_elements_text(records->'localPreviewDocumentIds') AS id FROM test_workflow_archives WHERE key LIKE 'LOCAL-REVIEW-SAMPLES-%'")).rows;
  const quotations=(await pool.query(`SELECT quotation_id AS id FROM quotation_archives_current WHERE archived AND quotation_id IS NOT NULL
   UNION SELECT cni_proposal_id FROM quotation_archives_current WHERE archived AND cni_proposal_id IS NOT NULL
   UNION SELECT v.id FROM cni_proposal_versions v JOIN quotation_archives_current a ON a.cni_proposal_id=v.proposal_id AND a.archived
   UNION SELECT r.id FROM quotation_revision_requests_current r JOIN quotation_archives_current a ON a.quotation_id=r.source_quotation_id AND a.archived`)).rows;
  return new Set([...rows,...quotations].map(row=>row.id));
}
