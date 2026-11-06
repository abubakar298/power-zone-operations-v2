# Accounts workspace — first working milestone

Accounts, Management and Administrator have access. Accounts can read all purchasing costs, including BESS and C&I. Other departmental cost restrictions remain enforced by the API.

## Daily queues and decisions

- IPO Review: compare the immutable approved quotation with its issued IPO, discount allocation and PT selling breakup. Verify or return with a reason. The original quotation/IPO amounts cannot be edited here. Accounts review status/reason appears against saved IPOs in the Coordinator orders list. Returned work must use the existing revision workflow; verification never reissues an IPO.
- Inventory Reconciliations: read sent IRR versions and download their protected attachments. Return the current report to Inventory with a correction reason. Reports cannot be returned while a closure is awaiting Management or already closed.
- Job Closure: search/select received IRRs; enter actual costs excluding GST for Solar Panels, Structure, Inverter, Batteries, BMS and the four EPC categories. BESS subtotal is a display subtotal, not an additional cost. EPC actual is calculated from Electrical Labour, Earthing Cost, Deliveries and Installation Cost.
- Save a draft, then submit complete actual costs, evidence references and variance remarks. Accounts cannot approve its own closure. Management/Administrator approves and closes, or returns for revision.
- Invoicing is explicitly Coming soon. Reconciliation balances are potential adjustments only and never automatically change an approved selling amount.

## Sources and evidence

UBL budgets use each site's saved configuration/stage baseline. Regular jobs use their IPO-linked BOQ and saved additional scope. Current Rate Master changes never rewrite these budgets. UBL installation budgets may combine delivery with labour; this basis is shown rather than inventing a split.

Acknowledgment, site-photo and PT evidence are currently entered as document references or links for Management review; reference entry does not itself verify a signed document. IRR attachments retain the existing protected download workflow. Additional Accounts attachment uploads are a later extension.

All decisions create immutable versions and audit entries. Stale saves and conflicting retries are rejected. Closure submission/decision requires the current sent Inventory report. Live UBL closed-job and actual-performance figures include only Management-approved Closed versions.

## Interaction rule

Failures appear beside the action or attachment control that initiated them. Initial page-load failures may appear at page level. IRR attachment automatically creates the first draft when needed; no disabled attachment control requiring an unexplained preliminary save.

## Verification

Focused repository tests cover cost access, markup-on-cost, missing actual values, immutable review history, correction returns, stale saves, Management-only approval and UBL closed-job projections. A disposable browser journey verifies attachment before draft, Inventory handoff, actual-cost entry, inline decision errors and Management closure. Production records are never used as test fixtures.
