# Quotation review regression checks

Release scope: quotation preparation, management review and six-format comparison export.

- Clearing an inline discount means zero and restores the gross payable.
- In the default quotation mode, customer line amounts and subtotals show standard selling prices. An allowed discount is listed separately and deducted once from the gross payable; it does not rewrite the printed item prices.
- Description, date and validity edits retain the preview and refresh it automatically. Older preview responses cannot authorize a newer edit for saving.
- Save quotation version preserves an immutable version. Save and send for approval additionally submits that saved version. If submission fails, the saved version remains available for retry using Send for approval.
- The saved quotation view exposes workflow actions appropriate to the signed-in user and latest version. The server remains authoritative for identity, ownership and transition order.
- Revision feedback is entered in an application form, with confirmation before submission, on both the dashboard and quotation page.
- Management discount simulation changes no records. Net payable updates immediately. Profit calculations use the approved BOQ cost, accepted selling values and existing proportional discount allocation to eligible 18% items, leaving solar unchanged. Separate-tax revenue excludes GST; included-tax revenue uses the inclusive selling value, matching the existing PT basis. Profit % on cost and margin % on sales are labelled separately.
- A changed simulated discount must be sent as revision feedback before approving a quotation with that discount. Approval always applies to the actual saved quotation.
- The six-format review PDF uses the original saved pricing, approved costing, discount and terms. It makes no quotation versions or workflow events and rejects any payable mismatch. It is labelled as a comparison preview. Legacy additional items outside approved costing require costing revision before comparing formats that cannot represent that additional scope.

Validation: native PostgreSQL regression suite, production build, and six browser workflows covering authentication, costing, permissions, quotation editing, approval submission, management simulation, revision feedback, IPO and Operations handoff. Production verification uses read-only preview/download actions against the user's current quotation.

## Owner-approved optional revision presentation · 23 October 2026

Atif can select **Add discount to selling price** when preparing a revision. The approved total discount is allocated proportionally to eligible rows; solar panels, structure and earthing remain protected. Applicable GST is recalculated from discounted prices. Cash deals follow their saved GST treatment. All six PDF presentations remove the separate discount rows in this mode. Saving, six-format exports and IPO allocation retain the same accepted payable and never deduct the discount twice. The option requires a revision request, and earlier saved quotation snapshots remain unchanged.

Standard-price quotations retain standard row amounts. Separately displayed GST and the displayed discount must reconcile those rows to the accepted net payable. Legacy before-tax discount inputs remain distinct from the printed inclusive discount amount when generating an IPO.

The release is based on the deployed 20 October commit, excluding unrelated unreleased procurement work. Local verification uses frozen dependencies, production audit, build/type checking, the complete native PostgreSQL suite, browser journeys and A4 PDF checks. Navigation reload and first-draft quantity retention are included because browser verification exposed those regressions.

### Browser suite update

Browser fixtures now use the currently shipped single-step pricing preview, preliminary BOQ references, searchable multi-brand controls and current approval actions. The obsolete all-in-one authentication/costing/IPO script was split into focused checks for authentication and restart, standard quotation prices and PDFs, Management review immutability, revision discount embedding and six-format export, role isolation, external evidence approval, draft retention and encrypted recovery. Measured-survey and Quick BOQ journeys both verify the current entry/approval path through a read-only IPO allocation. Native integration tests retain exhaustive calculation, immutable history, sale submission and Operations handoff coverage.

Browser testing also exposed a portfolio render crash when protected BESS costs were absent. Unknown/restricted financial totals remain unavailable rather than becoming zero. No authorization or database rate limits are relaxed, and there are no skipped tests.
