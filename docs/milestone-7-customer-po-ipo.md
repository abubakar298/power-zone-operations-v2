# Milestone 7: quotation-based sale confirmation and IPO

Reference: owner-supplied `07-Internal Purchase Order (IPO).xlsx`, and subsequent owner instructions. The workbook's sample names, references, dates and blanket GST/PST headings are not production business rules.

## Workflow

Select the exact saved quotation accepted by the customer. Record confirmation type (Customer PO, Written approval, WhatsApp approval or Verbal sale confirmation), confirmation details, receipt/order date and the relevant invoice, customer, delivery and payment contacts. Customer PO confirmation requires its reference. An optional authenticated PDF/PNG/JPEG attachment (up to 8 MB) is persisted in PostgreSQL with a SHA-256 hash. Verbal confirmation is represented by the employee's recorded details; the software does not claim that verbal evidence is a customer-signed document.

Preview the IPO and submit immutable evidence for review. Employees can prepare and submit; Admin/Management can review and approve. Admin/Management can also review and issue their own prepared IPO. Pending submissions survive reload. Approval creates an immutable customer sale-confirmation record and IPO in a transaction, linked to the exact quotation and approved BOQ. A completed submission can produce only one IPO. Request keys protect save/approval retries and changed previews are rejected. Customer PO references cannot be duplicated for the same customer. Non-PO approvals do not require an invented PO reference.

Pricing uses accepted quotation selling values and tax categories, not BOQ internal costs or the template's blanket 18% GST / 16% PST placeholders. All accepted scope is included in the IPO so that solar and installation/other materials cannot be omitted from its total. Customer/technical scope cannot be edited in the IPO. An upstream quotation/BOQ revision is required for scope changes.

## Discount and future reporting

Keep solar and all non-18% tax categories unchanged. Allocate the quotation's after-tax discount proportionally across eligible 18% tax-inclusive selling amounts, in integer cents using largest remainders. Derive each adjusted before-tax amount from its adjusted tax-inclusive amount divided by 1.18. Record any difference from ordinary line-tax rounding explicitly; never silently move money into solar or an ineligible item. The IPO's final total must exactly equal the accepted quotation's net total. Reject discounts exceeding eligible scope value.

The immutable allocation preserves original before-tax values, original tax and total, each allocated after-tax discount, before-tax and tax reductions, adjusted amounts, net unit rates and tax-rounding adjustments. This supports future departmental and executive reporting. Net rates are stored to six decimals; monetary line totals are authoritative and retained to two decimals. Original BOQ costs, pricing versions and quotation snapshots are not rewritten. IPO PDFs show adjusted net rates and amounts without a separate discount row. Internal allocation details remain available on the authenticated review/history screen.

## Scope boundaries

Direct inverter/battery sales without a quotation or BOQ are explicitly deferred by the owner. Store issuance, physical inventory, installation reports, invoicing, external accounts-software integration, actual-cost comparisons, job closure, departmental dashboards and KPI formulas remain later milestones. The owner roadmap is retained separately in `Power-Zone-Department-Roadmap.md`.

This is an internal purchase order, not an implemented statutory invoice or a claim of FBR integration. Accounts still generates invoices in its own software.

## Verification

Native PostgreSQL tests cover allocation boundaries, mixed tax categories, exact final-total reconciliation, saved discounted quotations, authentication/CSRF, document validation/access, reviewer permissions, idempotency, immutable submissions/POs/IPOs and preserved quotations. Chromium smoke covers preparing/submitting evidence, reload, approval, saved history, PDF download and mobile layout. PDFs are rendered and visually inspected before release.
