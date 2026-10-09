# Milestones 4–7 — Coordinator usability completion

## Newly completed capabilities
4. Unified customer/site Project Workspace: Overview, exact saved Documents/versions, chronological Activity, Site Details, permitted attachments/evidence, IPO/PT and handoff links, next actions and return-to-project navigation. Backend ownership predicates are reused for every source; index contains explicit public metadata only.
5. Customer/site-first New BOQ, existing four family paths, Survey/Quick selection, searchable product and BESS selectors, project-prefilled creation and unsaved-change protection. Existing drafts/calculation engines/idempotency remain authoritative.
6. Non-BESS category review with an explicit visible cost subtotal excluding BESS equipment, complete selling totals, contextual revision instructions, preserved proposed-discount entry requiring Management approval, distinct immutable draft versus submission actions and unsaved-change guard.
7. Documents/Projects search the complete permitted metadata index (including historical C&I versions, IPO submissions and Operations handoffs), by customer, site name/code and reference. Historical reference search opens the correct project. Exact document previews/downloads retain authorization. Document sidebar returns to the library rather than staying trapped in a project; search/filter context survives. Existing global notification center and its task routes are reused; cancelled navigation does not reset selected notification context. Shared semantic components, loading/empty/error states, dates, numeric formatting and mobile layouts are reused.

## Verification ledger
- M4: typecheck/build/server compile passed; native project API1/1 and C&I workflow1/1 passed; exact-version project preview/navigation fixture passed.
- M5: typecheck/build/server compile passed; four-family context/relevant-field/search/unsaved/mobile fixture passed.
- M6: typecheck/build passed; cost-visibility7/7 passed (real authenticated APIs, roles, masters/history/nested costs); pricing subtotal/privacy/unsaved/mobile fixture passed.
- M7: native BESS Only/Direct Product3/3 passed (formats, fixed charges, equipment, privacy, discounted IPO/PT reconciliation). Survey/Quick complete Coordinator browser journeys2/2 passed through Management, customer evidence, IPO approval and both departmental handoffs. Full permitted search, historical project matching, exact saved previews/downloads, 403 denial and existing sidebar/navigation fixture checks passed. Authentication checks8/8 passed across focused runs (7 in the complete run, quotation-review1/1 in the corrected standalone run); Direct Product browser1/1 passed. The standalone review rerun used a separate artifact directory after a concurrent runner cleanup collision. Client/server type checks and production build passed.

The first integrated journey attempt identified removal of the existing Coordinator proposed-discount control. Restored it without changing Management authority or financial calculations; the rerun passed. Fixture locator mismatches were corrected, without dropping business assertions. No full backend/browser historical suite or broad security audit was manually run.

## Limitations / acceptance
- Saved drafts expose their current stored version; older unsaved edits cannot be reconstructed. Missing site codes group by customer/site name until recorded.
- Historical C&I preview/download opens its exact saved version; Open current workflow deliberately opens the latest actionable workflow.
- The read-only metadata index is unpaginated for current prelaunch volumes. At larger scale, add permission-preserving pagination/search, without silently dropping historical versions.
- Linked files remain subject to existing ownership checks; no new file-sharing permissions.
- This milestone does not complete unrelated future department screens or invent missing source records/events.
- Recommended employee acceptance: find an old reference, open its project history/preview, start each family, verify discard cancellation, prepare a quotation draft/submit, and return via project context. Use designated sample records for any live writes.
- No business-rule owner decisions remain. Backup client failure requires login Keychain availability; no credentials/setup were changed.

No schema migration, master-data edits, production sample deletion or historical snapshot rewrite occurred. Releases remain intentional with Render automatic deployment disabled.
