# Department workflow direction — Abu Bakar, 7 October 2026

These are user-provided requirements and future workflow direction. They do not establish unimplemented stock balances, procurement calculations, accounting rules or closure criteria.

## Site activity threads and workflow notifications — requested 7 October

Each new site needs one persistent thread that presents relevant documents, revisions, approvals, comments, history and stage changes together. Preserve original document versions and attribution. Department and personal views must respect permissions; sharing a thread must not expose internal pricing or documents beyond the recipient's access.

When a document is handed to a department or assigned person, enqueue an email notification with its pending action and a permission-checked link to the site's thread. Recipient membership and personal assignments must be explicit. Use durable transactional outbox records with delivery retries and duplicate prevention; email delivery failure must not undo or duplicate the business handoff. Sender intended: chint@powerzone.com.pk (updated by the owner on 7 October 2026). Email provider activation and recipient configuration remain pending. This records the requested next milestone, not a claim that notifications or site threads are live.

## Current basic departmental milestone

Inventory receives Operations' Store-issued BOQs, opens frozen requirements and delivery details, and records preparation/dispatch progress. Accounts receives IPOs and Peachtree phase divisions, records review notes and tracks missing supporting documents. These queues are implemented. Dispatch checkpoints do not post stock movements. No physical inventory ledger or actual project costing is fabricated.

## Procurement and inventory upkeep

Inventory Manager: Shaigan. Storekeeper: Jaleel. The Inventory interface will record opening stock, issue outward delivery orders (DOs), receive uploaded installation reports, and record inward gatepasses for physical stock additions. These actual movements will drive the live stock report. Opening stock and transaction controls are the next inventory milestone; the current dispatch checkpoints alone do not change stock.

Operations needs a procurement interface/tab to see stock available, newly incoming IPOs, required stock, expected remaining stock and what needs purchasing in advance. Procurement should update purchasing status for each product. Purchasing financial amounts can be entered later; Peachtree continues handling costing. Opening stock, actual issue/receipt transactions, reservations and product matching must be supplied/defined before availability and shortage figures become reliable. Procurement status must not itself count as a physical Store receipt.

Expected unused-stock returns may be communicated from a site before items physically reach Store, sometimes weeks later. Inventory records expected adjustments for Accounts separately; physical stock is added only when actually received. Keep that distinction in all forecasts and reports.

## Operations site progress

Operations will have a site progress tab covering planning, actual progress, vendors involved, time performance, quality-control interface and documentation. Documents serve both internal records and invoicing. Hamza Mir's Operations email is hamzabutt@powerzone.com.pk; his account form is prepared pending the user's password entry and submission. Moaz Ahsan's email is still required. KPI targets, planning/quality stage transitions, vendor responsibilities and document approval rules need further detail; do not invent them.

## Accounts downstream workflow

Accounts receives the installation report from Store/Inventory and the commissioning form from Operations before creating an invoice in its existing software. The installation report can identify items to add to or reduce from the invoice. Accounts verifies required controlled revisions instead of changing immutable accepted quotes, BOQs or IPOs. Earlier requirements also include customer sign-off, customer-signed delivery orders and site photographs.

Actual costing and invoicing remain external initially. Later integration will compare actual cost with the final accepted quotation's budget by Peachtree phases, record management review, and send job-closing requests to Director Operations. Job closure in the accounting software and notifications for subsequent expenses are future scope. Supporting-document completion, invoice adjustments and closure criteria still need user-defined details.

## Director identity and branding

Director costing approvals have separate Send to Coordinator and Create quotation myself actions. The separate Director login is intended for amc.abubakar@gmail.com using Management role; the account setup form is prepared, but the user must enter the passwords and submit it. Current admin email remains a separate unique login.

The proposed new digitalisation company is distinct from Power Zone Engineering & Services. 'Power Zone Digital' is provisional; 'Power Zone Systems' was recommended but not selected. Logo refinement is deferred to tomorrow. The symbol must remain recognisable on its own as an iOS/Android app icon. No concept has been applied to the application or legal sales-document branding.
