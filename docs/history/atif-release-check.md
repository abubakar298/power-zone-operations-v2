# Atif Coordinator release check — 7 October 2026

The Coordinator workflow is survey/general BOQ draft → costing review → approved costing and quotation instructions → pricing → immutable quotation → quotation approval → customer confirmation → IPO evidence review → immutable combined IPO/Peachtree pack → BOQ issuance to Operations. Management waiting is separate from Coordinator preparation time. Existing engineering, tax, discount and historical version rules are unchanged.

Browser coverage includes a complete Coordinator sample with a separate management context, forbidden Coordinator approval, cancellation without a workflow event, persisted bucket changes, combined PDF response, mobile overflow and cross-tab logout. Other browser scenarios cover survey OCR, revisions, customer creation, rates/specification permissions, approval instructions and downstream department boundaries.

Workflow confirmations use the browser's modal OK/Cancel dialog, with action and consequence explained before any request. They cover costing submission/decisions/external approval, quotation and pricing saves/revisions, quotation submission/decision/sale receipt, IPO evidence submission/issuance, Operations and Store issuance, delivery planning and department stage updates. Opening a screen, calculating a preview and ordinary draft edits do not advance documents and need no extra confirmation.

## Owner-requested test-document cleanup

The owner confirmed earlier that existing BOQs, quotes, revisions, POs and IPOs are sample testing data, and on 7 October requested all sample documents removed before a fresh manual workflow test. Customer/master data must remain.

Migration 021 adds an immutable, private recovery archive only. No migration deletes workflow data. A single exact operator setting `PZ_ARCHIVE_TEST_WORKFLOW=owner-confirmed-test-workflow-2026-10-07` enables the explicit maintenance action during startup, using the service's existing private database connection. Clear it after verification. No public cleanup/restore endpoint exists.

The action locks an explicit allowlist of workflow document tables, refuses any document created after the fixed cutoff `2026-10-07T06:52:51Z`, copies complete rows (including original snapshots and upload bytes encoded by PostgreSQL JSON) into `test_workflow_archives`, then clears those active tables in the same transaction. No CASCADE, disabled trigger, master-data change, account change or database network change is used. A failure rolls back everything. The immutable archive key makes retry a no-op even after fresh work starts. Training batch registry is retained to prevent samples reappearing on redeploy.

Customers, sites, item/rate/rule histories, users, sessions, audit history, bootstrap state and the training batch registry remain. Historical test snapshots are preserved in the recovery archive. Recovery is an operator database transaction: load records from the archive with `jsonb_populate_recordset` into the corresponding original tables in dependency order, with deferred/cyclic draft/BOQ references handled deliberately; verify IDs and counts before committing. Recovery must not overwrite new work or reuse document numbers without reconciliation. The backup is for recovery, not a user-facing historical report.

## Completed manual test cleanup — 7 October 2026

The owner subsequently requested **all sample workflows** cleared, explicitly retaining Mr. Arshad's customer. A separate archive key `owner-confirmed-completed-samples-2026-10-07-115531` and fixed cutoff `2026-10-07T11:55:31Z` cover that completed test. The original archive key/cutoff remain unchanged. The same atomic allowlist and recovery rules apply; customers, sites, masters and accounts remain. Clear the operator environment setting after successful verification.
