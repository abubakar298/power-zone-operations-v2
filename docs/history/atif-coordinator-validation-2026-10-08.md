# Atif Coordinator validation — 8 October 2026

Scope: the existing Coordinator workflow only. Base release: f606cf0c7bf01b428cf59b8d258516ddbe3ec3d2. No production transactions, migrations, seed changes, permission weakening or deployment were performed in this validation pass. The production baseline remains separate.

## Stage results for this candidate

| Stage | Result | Evidence |
| --- | --- | --- |
| Authentication/session/logout | PASS | Existing browser suite checks login errors, reload, process restart, logout and relogin; new journeys use actual Coordinator and Management accounts. |
| Customer/site selection | PASS after fix | Search retains selected customer identity; changing customer clears the prior site. Quick BOQ uses an existing active master site without duplicating it. Existing inline customer creation remains covered. |
| Survey/Quick BOQ | PASS | Survey manual AC lengths and Quick automatic cable allowances; BESS-30-40 and dual-inverter BESS-24-60; drafts saved and resumed through UI. |
| BOQ/costing | PASS | Full 94-test backend suite; all six historical workbook cases pass; BAFL-5850 reference total PKR 6,456,786.00. |
| Management review/unlock | PASS | Management approves costing with quotation instructions, Coordinator resumes the approved revision. Coordinator approval attempts rejected. |
| Revisions/history | PASS | Existing browser and backend coverage includes returned costing, quotation-only and costing revisions, bucket transitions and immutable earlier documents. |
| Commercial pricing | PASS | Saved quotation links to its exact approved BOQ revision; no unauthorized ownership access. |
| Quotations/discounts/PDF | PASS | New UI journeys clear and reapply discounts, edit wording, render previews, save and submit; PDF download checked. Existing tests cover management discount preview/revision and all six presentation/tax combinations. |
| PO/IPO | PASS | New journeys record customer confirmation, submit IPO evidence and have Management approve it; combined IPO/PT download succeeds. Existing external-approval route also tested. |
| Accounts/Operations handoff | PASS for Atif's sending workflow | Both handoffs submitted from IPO workflow; pending bucket clears only after both. Receiving portals are not accepted for rollout by this report. |
| Coordinator restrictions | PASS | Management/other departmental routes rejected; another Coordinator cannot retrieve this user's BOQ, costing PDF or quotation/PDF. Full permission regression suite also passes. |

## Confirmed defect and changes

A new BOQ offered no existing-site selector, and final approval rejected a site code already in Site Master even when no BOQ existed. Added customer and customer-scoped site search/selection. Approval now reuses an active master site's ID for its first BOQ, preserving the site record. Inactive sites and sites already containing a BOQ remain rejected; the latter must use revision. Added regression tests for preservation, duplicates and inactive sites. No financial or engineering formulas were changed.

The expanded browser suite hit the deliberately enforced production-strength login attempt cap when every specification shared one database. The test runner now discovers specifications and runs each against a fresh disposable database. No application rate limit was reduced or bypassed. Existing eight scenarios within auth.spec.ts still share fixtures and remain serial; further fixture isolation is future test maintenance.

## Verification

- Full backend suite: 94 passed, zero failures.
- Existing browser specification: 8 passed.
- New Coordinator specification: 2 passed (survey and Quick BOQ complete journeys).
- Production build/type checking: passed, including both browser specifications.
- Screenshots inspected: mobile survey form and desktop quotation preparation/actual PDF preview. Both new journeys assert no horizontal page overflow on mobile forms and completed dashboard.
- Local native PostgreSQL databases only; Chromium automation. Real iOS/Safari, Android, OS share-sheet delivery and employee acceptance are not established by these tests.
- Non-blocking tool warnings: third-party Rollup annotations and pg concurrent-query deprecation; no failed assertions. Connection shutdown messages during disposable test-server teardown do not represent a production database failure.

## Unresolved departmental blocker

Operations.tsx loads general /orders and its permitted /operations/portal together in Promise.all. Legitimate Operations users receive a correct 403 on the general orders route, which causes the UI to discard the permitted portal result. This receiving-screen regression remains unresolved and blocks Operations employee rollout. Atif's permitted sending actions passed independently. Do not weaken /orders authorization. This report does not declare the cross-department system production-ready.

## Usability findings and recommendations

The current flow has working bucket next actions, in-place management review/revision, draft resume, searchable customer/site choice, confirmation protection, success/error feedback, readable desktop financial summaries and an actual PDF preview. No major redesign was made.

Next programme recommendations: condense the long pricing/description page into clearer steps; keep key save/submit actions visible while editing; show explicit autosave/unsaved state; guide users directly to revision when selecting a site with an existing BOQ; improve small-screen wide-table navigation; add a concise persistent document timeline and attachment checklist. Validate these with Atif during the restricted pilot before changing layouts.

## Recommendation

READY FOR ATIF PILOT for this tested candidate, subject to approval to deploy this fix and a brief post-deployment smoke check. The currently deployed release still has the existing-site first-BOQ defect. No new code was deployed. Other departmental rollouts remain deferred. Automated email is not a pilot prerequisite.
