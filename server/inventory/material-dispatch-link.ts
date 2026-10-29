/** One physical site DO retains its original fixed/variable preparation IDs.
 * Read/return callers must also restrict line keys to their authorised draft. */
export const materialDispatchDraftLink="(d.draft_id=$1 OR d.snapshot->'combinedPlan'->>'fixedDraftId'=$1::text OR d.snapshot->'combinedPlan'->>'variableDraftId'=$1::text)";
