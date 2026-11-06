# Inventory and Accounts follow-up — 11 October 2026

## Implemented in this release
- EPC actual minus budget variance, even when only an aggregate actual EPC total is available.
- Actual markup percentage against the arithmetic average of other Management-approved closed jobs of the same UBL configuration. The current job is excluded. Empty cohorts are unavailable, never zero.
- Management dashboard job-closing count and review connect to Accounts' real closure queue.
- Approved quotations awaiting send: Coordinator confirms customer or salesperson delivery against the exact saved quotation. Sharing does not imply sending.
- Prior Management discount instruction can approve a saved first-issue regular quotation without another Management wait. Screenshot evidence, exact-version attestation, ownership and immutable approval history remain required.
- C&I has the same screenshot-backed instruction path and PDF WhatsApp/share control as regular quotation families.

CHP-320 remains awaiting Management. No closure decision or invoice adjustment is posted by this release.

## Excel exports for discussion
Suggested locations: filtered Documents library, saved BOQ detail, approved quotation detail, IPO/PT Accounts review, Inventory reconciliation review, UBL configuration costing/history, and filtered UBL jobs list.
Exports should reflect the displayed saved version and active filters. Accounts/Admin/Management may export costs; Coordinator and Inventory exports must enforce their existing cost restrictions. Quotation/IPO/PT customer-facing exports should contain selling values, not internal purchasing costs. Discuss these locations before implementation, as requested.

## Demo cleanup scope and constraint
The live customer is customer ID 0, Demo Sites, short code DEMO. Cleanup must target only this customer and linked sites/documents, not all training customers, UBL records, stock records or production workflows. Existing broad test-workflow truncation is unsuitable: it archives every workflow and has a historical cutoff.
There is no normal product recovery/delete flow for this exact customer. Permanent deletion through browser requires action-time confirmation. Keep exact scoped preview and recovery archive before deletion; do not bypass immutable document controls or pretend deactivation removes saved documents.

## Intentionally deferred by explicit instruction
DO/material-issuance/client-acknowledgment document layouts are for later discussion. Invoicing remains Coming Soon. Opening-stock/warehouse ledgers, reservations, procurement and dispatch are separate future implementation beyond the approved Inventory/Accounts closure pilot; no invented stock balances or dispatch records.
