# Coordinator daily workspace — Milestone 3

The existing six workflow baskets remain authoritative. The Coordinator sees Survey & BOQ Preparation, Quotation Approval, Revision Required, Customer Confirmation, IPO Approval, and Operations & Accounts Handoff. Display labels do not change stored stage values or approval authority.

Needs My Action is the default presentation filter: preparation, revisions, and ready handoffs. Waiting on Others shows quotation approval, customer confirmation and IPO approval. Selecting a basket/stage clears the priority-group filter to show that basket. All pending tasks clears group/stage only; search and overdue remain independent. Bucket/group counts always reflect all authorized pending tasks, not the filtered result list. Default sorting is overdue first, then longest waiting. Other choices: longest waiting, newest, customer/site.

My Next Actions rows include customer/site, document, stage/responsibility, waiting time, target/overdue status and a concrete next-action link using the existing onOpen task contract. Customer names are added to the existing scoped read-only overview query from the same saved snapshots (drafts use their selected customer). No financial metadata is added. Missing draft customer/site values are identified rather than invented.

Management scope/approval controls remain intact. All workflow transitions, permissions, immutable documents, rates and pricing remain unchanged. Search/filters perform no writes. The table scrolls horizontally on mobile to preserve document references and readable values.

## Focused verification
- TypeScript client/server checks and production build: PASS.
- Isolated native PostgreSQL dashboard sample test: 1/1 PASS, twenty pending records, six bucket counts totaling twenty, customer names for all sample record types, unrelated owner sees zero records, snapshots preserved.
- Isolated native PostgreSQL C&I workflow test: 1/1 PASS, customer name correct, original workflow/ownership/financial confidentiality checks preserved.
- coordinator-workspace-check.mjs: PASS — six independent counts, priority groups, sorting/search/stage/overdue filters, exact draft and C&I navigation, retained filters, empty state, mobile containment/keyboard focus, GET-only requests.
- coordinator-navigation-check.mjs: PASS — existing six sidebar destinations and project workflow entry points remain reachable.

No full backend/browser suite is needed for this targeted presentation increment. No migration or live sample changes are included.
