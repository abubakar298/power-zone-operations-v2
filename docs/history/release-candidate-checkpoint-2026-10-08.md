# Power Zone V2 release candidate checkpoint — 8 October 2026

This report describes the local hardening candidate, not a deployment. Production remains on the previously verified commit `de49d7a3efd7aaeb8d6ea9e271eb9a8105d9fd20`. No production business data was changed during this pass.

## Phase and release scope

The implemented solar coordination workflow is in production hardening: Design survey or Quick BOQ → costing approval → commercial pricing → quotation/revision → sale confirmation → IPO/Peachtree → Accounts and Operations handoff. Department dashboards beyond coordination are foundations, not complete departmental systems.

Last completed candidate work: centralized server authorization, ownership-scoped collections/documents/downloads, positive and negative access tests, historical workbook regression fixtures, response timeout/error handling, lazy workspace loading and a workspace recovery screen, and decimal-safe currency presentation. Next work is controlled candidate publication/CI and production release acceptance. Email activation remains separate.

Planning estimates, not measured coverage: core coordination workflow about 90%; full described multi-department product about 55%. Future inventory movements, procurement, site/QC execution, actual accounting integration and executive closing substantially increase the remaining scope.

## Feature status

“Working but needs testing” means automated candidate checks pass but production acceptance remains necessary. “Complete” refers only to the stated implemented scope.

| Module | Status | Scope / limitation |
|---|---|---|
| Authentication | Working but needs testing | Database sessions, secure cookies, CSRF, throttling, password recovery plumbing; final target-origin acceptance pending |
| Dashboard/application shell | Working but needs testing | Role workspaces, lazy loading, recovery screen |
| Users & roles | Working but needs testing | Eight roles; centralized department and Coordinator ownership checks; provider MFA separate |
| Customer Database | Working but needs testing | Persistent import/update, duplicate review, preserved IDs; production counts not re-queried in this pass |
| Site Database | Working but needs testing | Persistent customer-linked sites |
| Brand Master | Working but needs testing | Persistent reference versions and selections |
| Rate Master | Working but needs testing | Cost/specification masters; no rate changes in this pass |
| Rules & Logic | Working but needs testing | HV BESS, quick/survey cable logic; LV/on-grid deferred |
| New BOQ | Working but needs testing | Design handoff and Quick BOQ |
| BOQ + Costing | Working but needs testing | Six historical workbook cases pass |
| BOQ Database | Working but needs testing | Ownership-scoped records; bounded lists lack full pagination |
| Revise BOQ | Working but needs testing | Revision request → new costing review → quote workflow |
| BOQ History / immutable snapshots | Working but needs testing | Immutable stored versions and history |
| Commercial Pricing | Working but needs testing | Cost markup, taxes and pricing versions |
| Commercial Pricing Database | Working but needs testing | Persistent versions scoped to authorized users |
| Quotations / Quotation Database | Working but needs testing | Three presentation types, two tax modes, saved versions |
| Tax-included quotation | Working but needs testing | Gross amount; IPO tax display zero |
| Separate-tax quotation | Working but needs testing | Net selling amount plus GST |
| No-breakup quotation | Working but needs testing | Accepted grouping retained through IPO |
| Basic-breakup quotation | Working but needs testing | Accepted grouping retained through IPO |
| Detailed-breakup quotation | Working but needs testing | Detailed rows with combined protection categories |
| Manual Special Discount / Net Total | Working but needs testing | Discount/net total and management profitability previews; allocated discount conserves payable |
| PDF/print/A4 quotation output | Working but needs testing | Automated export and browser workflows; arbitrary long customer text still merits visual acceptance |
| Store Issuance | Partially built | Operations delivery planning and frozen Store BOQ; not a live stock movement ledger |
| PO / IPO workflow | Working but needs testing | Approval evidence, combined IPO/PT pack, department handoffs; direct sale deferred |
| Audit Log | Partially built | Actor/action/time history; no dedicated rich audit analysis screen or tamper-evident external log |
| Design | Working but needs testing | Survey attachment and technical requirements, Coordinator brand selection |
| Inventory / Accounts | Partially built | Department queues and progress checklists; not full stock/invoicing systems |
| Procurement / site execution / actual cost integration | Not started | Requirements direction only; dashboard placeholders do not implement these systems |

## Data evidence and limits

Local tests use disposable databases. Reference seed includes customers/sites/brands/rates/rules. Test fixture records are not evidence of production activity.

The preceding authenticated UI checkpoint showed 331 customers, 28 sites, 25 brands, 33 rates, 21 rules and 57 items; four BOQ revisions, five pricing records, six quotations, three IPOs and two Operations handoffs. These are historical observations, not a fresh direct production SQL inventory. They include reference, training and test records. Do not label every persistent record as real client work. Current production row counts, full user roster and production migration ledger remain unverified directly because public database access is restricted. That restriction was not relaxed.

The customer import previously preserved customer IDs and linked records; Mr. Arshad (observed ID 306) was retained. The import record reported 23 added, 246 updated, 16 unchanged and seven duplicate records made inactive after owner review. This hardening pass neither reran that import nor deleted records.

Reference sites include MBL Raiwind 0128, BAFL Skardu 2520, MBL 5858 and BAFL Jatli 5850. Training sites remain distinguishable only where their stored labels/batch identify them; a complete production classification needs a read-only database inventory.

## Validation

Read-only extraction from the historical workbook created a committed regression fixture with source checksum. Each case verifies quantities, rates, line amounts, phase totals, EPC components and overall total using decimal equality.

| Reference case | Expected total PKR | Candidate |
|---|---:|---|
| MBL-0128 R0 | 4,199,303 | Passed |
| MBL-0128 R1 | 4,240,843 | Passed |
| BAFL-2520 R0 | 5,575,271 | Passed |
| BAFL-2520 R1 | 5,144,757 | Passed |
| MBL-5858 R0 | 3,924,493 | Passed |
| BAFL-5850-001-R0 | 6,456,786 | Passed |

BAFL-5850 phase totals: Solar 1,509,300; Structure 774,000; BESS 2,933,716; EPC 1,239,770. EPC components: labour 193,500; earthing 90,000; delivery 116,100; installation 840,170.

Limitations: the historical workbook stores combined AC cable quantities, not the present four-entry termination split. It does not establish historical brands for every case. New HV configurations and current quotation/IPO calculations have automated rule tests; not every possible configuration has an independent workbook acceptance case. LV and on-grid logic are deferred. No business formulas or rates were modified during hardening.

## Security changes and tests

Department boundaries are enforced server-side, including PDFs and attachments. Admin/Management retain broad intended visibility. Coordinator document access follows originating BOQ/draft ownership and is checked on URL and body references. Collections are scoped before limits. Operations receives issued technical requirements; it cannot read commercial pricing/Peachtree PDFs. Inventory sees issued Store documents and its queue. Accounts gets IPO/PT only after explicit Accounts handoff. Design uses its survey/handoff workflow. Generic Employee has no financial workflow access until assigned an appropriate department role.

The authorization matrix checks legitimate owner/management access, another Coordinator guessing IDs, unauthorized departments, anonymous callers, body-reference substitution, collection leaks, uploads, BOQ history/PDF, pricing/quote PDF and IPO/handoffs. Existing repository action checks still enforce approval authority. These are comprehensive automated checks for the affected surfaces, not an independent penetration-test certification.

Final local results: **93 backend tests passed, zero failed; eight browser tests passed; three Python backup-client tests passed; production build/typecheck passed; production dependency audit reports zero vulnerabilities**. Test areas include auth/session restart/logout/mobile, masters, BOQ review/revisions, commercial pricing and tax formats, IPO/PT rounding, approvals/evidence, imports, department queues, Design uploads, backups and training/archive safeguards. Browser tests exercise the Coordinator-to-Operations flow and management revisions. Arbitrary attachment contents, every user/browser combination, live email delivery and a real production restore still require acceptance.

Initial application JS reduced from about 559 KB to 248 KB (about 169 KB to 77 KB compressed); PDF/OCR functionality remains loaded on demand. Currency displays now share a decimal-safe formatter, including BOQ review/history, quotation/pricing, IPO, department and Director views; zero, missing and invalid amounts are distinct. BOQ monetary summaries show cents instead of silently hiding fractional amounts. Stored calculations and PDFs are unchanged. Response support IDs avoid exposing request bodies or private values. Connection failures do not automatically retry mutations.

## Deployment and recovery

Paid Render web and PostgreSQL 18 resources are in Singapore. Same-origin frontend/API, exact APP_ORIGIN, database-backed sessions, HTTPS secure cookies, CSRF and health checks are implemented. See deployment.md for exact build/start commands and environment variable names. Secret values were not read or published.

There are 27 existing migrations; this candidate adds none. Production seed/setup is guarded, not a destructive reset. Uploads and application records are database-backed. Single-instance hosting/database have no high availability. Render production-branch auto-deploy remains a release risk: keep candidate changes off that branch until CI and release review are complete.

Encrypted application backup and isolated fixture restoration pass. Manual downloads and the enrolled Mac daily catch-up client coexist. Mac-off time prevents scheduled local downloads. A real production `.pzb` restore drill into an empty isolated database remains necessary operational proof; it requires the owner's private passphrase, which must never be shared in chat. Managed provider recovery retention must be verified in the provider dashboard. Backups do not include source, infrastructure secrets or email queue replay.

Resend domain verification/API credentials and Render email configuration are not confirmed complete. Existing outbox plumbing covers account links; complete stage-wise departmental email threads are not implemented. Do not describe email notifications as live.

## Git checkpoint

Repository: abubakar298/power-zone-operations-v2. Verified remote production branch: milestone-5/commercial-quotations, HEAD de49d7a3efd7aaeb8d6ea9e271eb9a8105d9fd20. The local source directory has no .git metadata, so a clean git working-tree claim would be false. Candidate code is published on `hardening/production-release-candidate` in draft PR #6 (the final branch head is the release reference); it is not deployed. Preserve the unrelated pre-existing tests/orders.test.ts import edit. Release publication must use an explicit reviewed file list on a separate candidate branch; do not upload .local logs, credentials, databases or generated artifacts.

## Remaining priorities and recommendation

P0 release gates: publish and verify an exact candidate SHA; do not merge/deploy unreviewed security work. No known failing permission regression remains in the local test suite, but production has not received these fixes.

P1: actual production-backup restore drill; target-origin role/session smoke checks after release; configure controlled deploy/required CI; verify managed recovery retention and monitoring; activate email only with provider credentials and a delivery test. Keep authentication/provider accounts protected with MFA where supported.

P2: paginated collections and query-index review as volume grows; richer structured audit reporting; long-text PDF visual checks; more granular staff assignment if multiple coordinators must share specific jobs; outstanding department systems and actual accounting integration. Existing pg client concurrent-query deprecation warnings in fixture runs should be resolved before upgrading pg major versions.

No application is hack-proof. This is a tested local candidate, not proof of complete production security or complete planned product scope.

**B. READY FOR CONTROLLED PILOT ONLY — DEPLOYABLE AFTER THESE SPECIFIC FIXES / RELEASE GATES.** Keep production unchanged until candidate publication/CI and recovery/release checks are resolved. The implemented coordination scope can then enter a controlled pilot; full inventory, procurement, site operations and accounting should not be advertised as finished.

## Publication evidence

Draft review: https://github.com/abubakar298/power-zone-operations-v2/pull/6. The security candidate began at 20fc2dbfadc24955ba5c83320e33c5f2cf0ff42d; decimal display changes were added in d838bc1de0dd8cabb8ce09b67de53f6e8f7cdc87. The final head is recorded in the PR. CI was dispatched for this separate branch. Production branch remains untouched. The browser costing assertions were updated from whole PKR to the intended two-decimal display; reference values themselves are unchanged. The immediately preceding production commit adds validated Rafiq email sender display configuration; its parent is 74618e19ff62578b2e0eb1fa45173f7bbdea1907. See the route inventory alongside this report for implemented router paths.

## Additional engineering limitations

- Director actual cost/profit/variance remain unavailable until accounting integration; closing requests currently have no implemented feed. These are not live accounting comparisons.
- Account department phase enrichment performs per-record queries; bounded pilot queues are acceptable, but this should be batched and indexed before large-scale usage.
- Several UI data models still use broad TypeScript any types. Security decisions use server session/role checks and parameterized queries; replacing all UI models is deferred rather than a broad rewrite.
- Workspace tabs are application state rather than independent deep-link routes. Reloading can return to the dashboard; saved data persists, unsaved forms are not guaranteed to survive reload.
- Screen dates generally follow the device locale/timezone. KPI clocks use stored timestamps; after-hours/business-calendar exclusions are not implemented beyond the approved management-wait exclusion.
- File signatures/size/access controls are implemented; malicious-file scanning and an independent penetration test are not provided.
- Long descriptions and arbitrary customer/address lengths need continued PDF visual acceptance. No approved document wording or branding was changed in this pass.
- Audit actions retain actor/time and entity identifiers in action strings; an external append-only audit sink and structured entity columns remain future hardening.

Browser fixtures currently share setup across scenarios, so a failure in initial setup can cause dependent scenario failures. The suite runs serially; future test isolation should remove this dependency.
