# Inventory and Accounts — basic department workspaces

Inventory receives only BOQs Operations has issued to Store. Each received document keeps its frozen requirements and Operations delivery plan. Buckets track Received BOQs, Preparing stock, Ready for dispatch and Dispatched. Recording progress requires a note/reference, advances one stage at a time and never posts a stock movement. Expected returns and physical receipts remain separate responsibilities for the later stock-control milestone; neither is inferred from dispatch or installation.

Accounts receives existing saved IPOs. New IPOs, Review in progress and Awaiting documents buckets open the original IPO and Peachtree division PDFs. The screen shows the saved phase division, with zero displayed IPO tax for Tax Included and unchanged payable. The supporting-document requirements are customer sign-off, signed delivery orders, site photos and Inventory's installation report/revision review. A checklist describes requirements, not verified receipt; review notes can record outstanding documents and their references. Invoicing, actual costs and external ledger closure remain in Peachtree. No fake actual costs or completed closing requests are generated.

Both workspaces support elapsed stage age, manual refresh and an immutable actor/timestamp progress history. No department KPI targets were supplied. Inventory and Accounts roles land on their own dashboards and cannot mutate costing, quotations, IPO approvals or coordinator workflow. Admin/Management can open both workspaces. Admin Team access can create department users; no real account was created without an employee identity.

Migration 020 adds roles and append-only checkpoints. Source-row locking serializes updates, expected versions reject stale writes, request keys replay exact retries and reject conflicting reuse. Original issued documents remain immutable. These are basic document queues, not a complete inventory or accounting system.

Director portfolio now includes every saved quotation version for each BOQ family with quoted date, original attached BOQ/cost, selling revenue, payable and margin. Latest-only portfolio totals still avoid double-counting versions. Customer selection clears old results while loading. Saved versions do not prove they were sent to a customer.

Validation: native PostgreSQL regression tests, role/CSRF/stale-update/retry/immutable-source tests and browser checks for both department dashboards and separate department logins.

Director costing approvals have explicit Send to Coordinator and Create quotation myself choices. Sending saves the immutable costing/instructions and leaves quotation preparation in the Coordinator queue; it does not send an external message. A separate Director login uses the existing Management role, requires a distinct email and a user-selected password.

New quotation cable notes show numeric excess-use rates per running metre: current Rate Master cost × 1.20 × 1.18, rounded to two decimals. The rate is frozen in the saved customer quotation note. Existing quotation snapshots/PDFs are unchanged.
