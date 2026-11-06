# Operations, Director reporting and general quotation workflows

Operations role receives issued IPOs/BOQs, sees delivery-planning buckets and records site contact, delivery address, date, time and instructions after receipt. Sending a BOQ to Store requires a saved delivery plan; the BOQ and plan are preserved in an immutable Store issuance. Demand is recorded once on BOQ issuance to Operations. This is required stock, not an inventory balance or a physical stock movement. Procurement and inventory transactions are later milestones.

Admin and Management dashboard includes Director Operations, the existing approval buckets, customer/site budgets and six Peachtree phases. Revenue and discounts use the exact saved quotation/IPO allocation, with gross selling values for Tax Included and selling values excluding tax otherwise. One current quotation per BOQ family is counted; historical versions remain accessible in their workspaces. Reports show up to 250 BOQ families and identify the limit. Actual costs and margin variances remain unavailable until Accounts supplies actual costing. Job closing shows no requests until Accounts submissions are connected; no closure rules are assumed.

Quick BOQ is selected from Survey & BOQ → Quick BOQ · no survey. User supplies PV panel count/wattage, customer/site, inverter, battery, structure and brands. Server derives:

| Allowance | Quantity |
| --- | --- |
| DC red and DC black, each | Installed watts × 0.0045 m |
| 2.5mm² earthing | Installed watts × 0.00075 m |
| 6mm² and 10mm² earthing, each | Installed watts × 0.003 m |
| Single inverter AC | 30 m 16mm²; no 25mm² |
| Dual inverter AC | 15 m 16mm²; 20 m 25mm² |

The allowance version is `general-cables-2026-10-v1`. Saved snapshots preserve that version and calculated quantities. Submitted client quantities cannot override these formulas. Survey-based BOQs retain their existing engineering rules. New quotation notes state that additional quantities cost their cost plus 20% markup followed by 18% GST; existing saved quote notes are unchanged.

Costing approval in the app records quotation presentation, tax display, six markup percentages and instructions against the exact approved BOQ revision. New pricing loads these settings. Previous commercial revision context retains its saved quotation settings.

A Coordinator may record external Director approval for their own submitted costing, attaching PNG/JPEG chat screenshots and entering the approver and quotation settings. An explicit confirmation is required. The system labels this “External chat” and preserves the recorder, claimed approver, uploaded evidence and instructions separately. It does not claim the Director authenticated or validate screenshot authenticity. Saved approvals/evidence cannot be edited; changes require another costing revision. Coordinator cannot use the authenticated Director approval endpoint.

Hamza Mir and Moaz Ahsan can be given Operations accounts using Team access after their actual email addresses are supplied. No invented accounts or credentials are created. Admin retains Director access; Atif’s Coordinator permissions are unchanged.
