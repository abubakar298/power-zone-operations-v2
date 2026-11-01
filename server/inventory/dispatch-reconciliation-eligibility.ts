/** Document/custody eligibility is separate from posting warehouse stock.
 * The immutable exceptions identify only the exact owner-confirmed backfilled DOs.
 * Never use this predicate as proof that a warehouse OUT has been posted. */
export const dispatchReconciliationEligibleSql=`(EXISTS(SELECT 1 FROM inventory_retrospective_dispatches retrospective WHERE retrospective.dispatch_id=d.id) OR NOT EXISTS(SELECT 1 FROM inventory_signed_dispatch_pending p WHERE p.document_kind='dispatch' AND p.document_id=d.id AND NOT EXISTS(SELECT 1 FROM inventory_signed_dispatch_postings z WHERE z.document_kind=p.document_kind AND z.document_id=p.document_id)))`;
