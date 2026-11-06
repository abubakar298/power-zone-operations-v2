/** Fixed SQL identifiers only. Draft sharing follows its existing BOQ/quotation
 * ownership; it never grants a Coordinator another customer's draft. */
export function editableDraftCondition(draft: string, actor: string) {
  const manager = `EXISTS(SELECT 1 FROM users u WHERE u.id=${actor} AND u.active AND u.role IN('Admin','Management'))`;
  return `(${draft}.owner_id=${actor}
    OR EXISTS(SELECT 1 FROM boq_working_preparations wp
      JOIN boq_revisions br ON br.id=wp.revision_id
      JOIN boqs b ON b.id=br.boq_id JOIN survey_drafts origin ON origin.id=b.draft_id
      WHERE wp.draft_id=${draft}.id AND (b.created_by=${actor} OR origin.owner_id=${actor} OR ${manager}))
    OR EXISTS(SELECT 1 FROM quotation_revision_requests_current req
      JOIN quotation_versions q ON q.id=req.source_quotation_id
      JOIN boq_revisions br ON br.id=q.boq_revision_id
      JOIN boqs b ON b.id=br.boq_id JOIN survey_drafts origin ON origin.id=b.draft_id
      WHERE req.draft_id=${draft}.id
      AND NOT EXISTS(SELECT 1 FROM quotation_revision_links link WHERE link.request_id=req.id)
      AND (q.created_by=${actor} OR b.created_by=${actor} OR origin.owner_id=${actor} OR ${manager})))`;
}
