## Confirmed presentation and PT rule (6 October 2026)

This rule supersedes fixed solar allocation and pooled-margin redistribution below. New Peachtree snapshots are version 2 and use the original accepted item prices after approved discount allocation. PT retains six phases: Solar, Structure, Inverter, Batteries, BMS, EPC. Separate GST uses before-tax values; tax-inclusive uses gross values. Presentation never changes payable or entered markup. Legacy pricing editors use effective saved row markups so a presentation-only revision preserves pricing.

IPO follows its accepted quotation: No Breakup has a combined price; Basic Breakup has category prices; Full Breakup has individual prices. Tax-inclusive IPO amounts include tax and expose no GST columns/breakdown; displayed tax is zero while internal historical tax data is retained. All reports reconcile exactly to the accepted net payable. Existing saved snapshots remain immutable.

Validation: 47 PostgreSQL-backed tests, TypeScript/build and browser flow passed; six sample IPO/PT pairs visually checked on A4.

# Milestone 7: quotation-based sale confirmation and IPO

Reference: owner-supplied `07-Internal Purchase Order (IPO).xlsx`, and subsequent owner instructions. The workbook's sample names, references, dates and blanket GST/PST headings are not production business rules.

## Workflow

Select the exact saved quotation accepted by the customer. Record confirmation type (Customer PO, Written approval, WhatsApp approval or Verbal sale confirmation), confirmation details, receipt/order date and the relevant invoice, customer, delivery and payment contacts. Customer PO confirmation requires its reference. An optional authenticated PDF/PNG/JPEG attachment (up to 8 MB) is persisted in PostgreSQL with a SHA-256 hash. Verbal confirmation is represented by the employee's recorded details; the software does not claim that verbal evidence is a customer-signed document.

Preview the IPO and submit immutable evidence for review. Employees can prepare and submit; Admin/Management can review and approve. Admin/Management can also review and issue their own prepared IPO. Pending submissions survive reload. Approval creates an immutable customer sale-confirmation record and IPO in a transaction, linked to the exact quotation and approved BOQ. A completed submission can produce only one IPO. Request keys protect save/approval retries and changed previews are rejected. Customer PO references cannot be duplicated for the same customer. Non-PO approvals do not require an invented PO reference.

Pricing uses accepted quotation selling values and tax categories, not BOQ internal costs or the template's blanket 18% GST / 16% PST placeholders. All accepted scope is included in the IPO so that solar and installation/other materials cannot be omitted from its total. Customer/technical scope cannot be edited in the IPO. An upstream quotation/BOQ revision is required for scope changes.

## Discount and future reporting

Keep solar and all non-18% tax categories unchanged. Allocate the quotation's after-tax discount proportionally across eligible 18% tax-inclusive selling amounts, in integer cents using largest remainders. Derive each adjusted before-tax amount from its adjusted tax-inclusive amount divided by 1.18. Record any difference from ordinary line-tax rounding explicitly; never silently move money into solar or an ineligible item. The IPO's final total must exactly equal the accepted quotation's net total. Reject discounts exceeding eligible scope value.

The immutable allocation preserves original before-tax values, original tax and total, each allocated after-tax discount, before-tax and tax reductions, adjusted amounts, net unit rates and tax-rounding adjustments. This supports future departmental and executive reporting. Net rates are stored to six decimals; monetary line totals are authoritative and retained to two decimals. Original BOQ costs, pricing versions and quotation snapshots are not rewritten. IPO PDFs show adjusted net rates and amounts without a separate discount row. Internal allocation details remain available on the authenticated review/history screen.

## Peachtree Division attachment

Each IPO offers a separate internal phase-entry PDF: Solar Panels, Structure, Inverter, Batteries, BMS and EPC (all remaining scope). Tax Separate uses adjusted before-tax selling values; Tax Included uses adjusted tax-inclusive selling values, with the IPO tax retained separately for reconciliation.

Full Breakup retains the accepted item prices/markups after discount allocation. Basic Breakup pools BESS and Balance/EPC profit over their combined costs and redistributes their selling value using a common weighted effective markup. Separately priced Solar, Structure, Earthing and an approved separately priced additional item retain their net accepted values. No Breakup alone fixes Solar at approved cost x 1.10 (tax separate) or x 1.21 (tax inclusive), then allocates the remaining value across the other phases proportionally to approved phase costs. Taxes are not reclassified as accounting profit. Internal phase allocation does not change quotation amounts, IPO payable or tax treatment.

New IPO snapshots preserve the division. Earlier IPOs derive the version-1 division from their immutable costing/pricing links, without reading today's masters or rewriting the IPO. Accounts' actual Peachtree entry/invoicing remains external; this is an internal attachment, not an API integration.

## Scope boundaries

Direct inverter/battery sales without a quotation or BOQ are explicitly deferred by the owner. Store issuance, physical inventory, installation reports, invoicing, external accounts-software integration, actual-cost comparisons, job closure, departmental dashboards and KPI formulas remain later milestones. The owner roadmap is retained separately in `Power-Zone-Department-Roadmap.md`. PO extraction/customer-master autofill and operations scheduling were subsequently requested and remain to be implemented; the current IPO form is reviewed manually. Procurement is a future department with rules to be supplied later.

This is an internal purchase order, not an implemented statutory invoice or a claim of FBR integration. Accounts still generates invoices in its own software.

## Verification

Native PostgreSQL tests cover allocation boundaries, mixed tax categories, exact final-total reconciliation, saved discounted quotations, authentication/CSRF, document validation/access, reviewer permissions, idempotency, immutable submissions/POs/IPOs and preserved quotations. Chromium smoke covers preparing/submitting evidence, reload, approval, saved history, PDF download and mobile layout. PDFs are rendered and visually inspected before release.
