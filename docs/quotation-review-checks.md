# Quotation review regression checks

Release scope: quotation preparation, management review and six-format comparison export.

- Clearing an inline discount means zero and restores the gross payable.
- By default, customer quotation rows and subtotals retain standard selling prices, and any allowed discount is listed separately and deducted once from the gross payable. On revisions, Atif can select “Add discount to selling price” to spread the discount proportionally over eligible items, protect solar panels, structure and earthing, recalculate GST, and remove the separate discount lines.
- Description, date and validity edits retain the preview and refresh it automatically. Older preview responses cannot authorize a newer edit for saving.
- Save quotation version preserves an immutable version. Save and send for approval additionally submits that saved version. If submission fails, the saved version remains available for retry using Send for approval.
- The saved quotation view exposes workflow actions appropriate to the signed-in user and latest version. The server remains authoritative for identity, ownership and transition order.
- Revision feedback is entered in an application form, with confirmation before submission, on both the dashboard and quotation page.
- Management discount simulation changes no records. Net payable updates immediately. Profit calculations use the approved BOQ cost, accepted selling values and existing proportional discount allocation to eligible 18% items, leaving solar unchanged. Separate-tax revenue excludes GST; included-tax revenue uses the inclusive selling value, matching the existing PT basis. Profit % on cost and margin % on sales are labelled separately.
- A changed simulated discount must be sent as revision feedback before approving a quotation with that discount. Approval always applies to the actual saved quotation.
- The six-format review PDF uses the original saved pricing, approved costing, discount and terms. It makes no quotation versions or workflow events and rejects any payable mismatch. It is labelled as a comparison preview. Legacy additional items outside approved costing require costing revision before comparing formats that cannot represent that additional scope.

Validation: native PostgreSQL regression suite, production build, and six browser workflows covering authentication, costing, permissions, quotation editing, approval submission, management simulation, revision feedback, IPO and Operations handoff. Production verification uses read-only preview/download actions against the user's current quotation.
