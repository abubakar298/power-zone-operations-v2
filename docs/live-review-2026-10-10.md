# Live review fixes — 10 October 2026

## Implemented
- New IPO intake requires the exact current, approved quotation with no pending revision. Historical orders remain readable; only Management reporting may use the separate read-only reporting path.
- Revision previews preserve the original special discount when omitted, compare payable, discount, format, tax and scope, and require explicit acknowledgment of a changed payable at save and Management approval. Management final-copy approval uses the same acknowledgment guard.
- Hannan R2/R3 read-only PDF comparison: both gross totals are PKR 2,326,602.64. R2 special discount is PKR 569,409.13 and payable PKR 1,700,000.00; R3 special discount is zero and payable PKR 2,269,409.13. Historical versions were not changed.
- External approvals show the actual approver, method, recorder, recording time and optional known decision date. Unknown historical dates remain unavailable. A Coordinator cannot record themselves as Management.
- Identical IPO intake fingerprints are deduplicated across request keys within existing transaction protections. Different evidence/amendments remain separate. Submission identifiers and evidence references distinguish pending entries.
- Project/library records distinguish workflow stage from version status; previews remove repeated stage labels and show version explanations. Hidden costing is labelled Restricted.
- Issued Operations handoffs open their issued record; Accounts and Operations receipt metadata are shown separately.
- Paired controls support wrapping labels and aligned controls/helpers. The existing BESS dropdown/calculation rules remain intact.
- C&I review uses the shared saved-document preview with loading/error/retry; library previews retain the same bytes for download. Document/project permalinks preserve exact context and permissions. Management Customers & Sites entry is clickable; content sign-out duplication is removed.
- Performance excludes explicitly identified training metadata by default, including descendants; an optional toggle includes it. Tasks and basket counts are unchanged. Timing remains elapsed calendar time with existing targets.
- Direct-product brand choices and server validation use the appropriate existing engineering category; inactive items remain excluded from new selection while historical data is preserved.

## Verification
- 144 isolated backend checks passed, including financial reconciliation, immutable versions, authorization, ownership, recovery, revisions and intake retry safeguards.
- 15 isolated browser journeys passed across authentication, survey/Quick BOQ, Management/external approvals, standard quotation/IPO/handoffs, Direct Product Sale, C&I notification links and single-phase costing.
- Production build/type checks passed. Browser test fixtures now approve the latest revision rather than attempting a new IPO against a superseded historical quotation; no eligibility guard was weakened.
- Frozen quotation PDFs were inspected without changing live business records. PDF layout checks preserve grouped protection rows, MTRS/JOB UOMs, centered units, structure panel count, financial totals and original templates.

## Limits / owner decisions
- Working-hours calendar and alternative SLA targets are not configured. Existing targets and elapsed-time measurements are retained; Management must define a calendar before business-hour reporting can be introduced.
- Historical duplicate-looking submissions are preserved; distinct evidence and customer orders are never automatically merged or deleted.
- Unknown historical approver decision dates are not inferred from recording dates.
- No live project record was altered by the verification journeys. All record-mutating tests used disposable local databases.

## Backup
The established encrypted 10 October backup exists and was verified before production changes. No passphrase, token or Keychain credential was read or exposed.
