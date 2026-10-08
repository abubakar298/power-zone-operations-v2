# Central communication system — implementation checkpoint

## Reused
Resend sender, secure invite/activation/recovery tokens, encrypted account outbox, current sessions/CSRF/role boundaries, immutable workflow events, approved corporate logo.

## Implemented
- Persistent notification bell, full unread count, read/unread, pending/history filters and keyset-paginated history.
- Exact authorized workflow destinations, including preserved email links through sign-in.
- Event projection for Solar Hybrid/BESS Only/Direct Product quotations, C&I approvals/revisions, IPO approval/issuance, Design assignments, Accounts/Operations handoffs and important account changes.
- Current-role/owner eligibility checked at inbox retrieval and again before email send; links confer no permissions.
- Completed/superseded requests resolve automatically; duplicate event/recipient keys and provider idempotency keys.
- Separate durable workflow email queue, bounded exponential retries and sanitized failure details. Business transactions never depend on email availability.
- Shared branded HTML/plain-text email design, approved logo with text fallback, reference-only payloads, Pakistan timestamps. No costs, margins, full snapshots or unrestricted free-text remarks in workflow emails.
- Employee nonessential-email preference; essential security notifications ignore it.
- Administrator type headings/email switches, delivery counts, reminder threshold and audit trail. One overdue reminder and one Management escalation per task, off by default.
- Signed raw-body Resend callback verification, timestamp tolerance and replay receipts; accepted vs provider-confirmed delivery states remain distinct.

## Activation / dependencies
Migration is additive; historical workflow/master records remain unchanged. Existing events are not bulk-emailed: collection starts at migration activation. General email sending remains gated by EMAIL_DELIVERY_ENABLED and the notification settings switch. Configure RESEND_WEBHOOK_SECRET privately in Render and register /api/email-webhooks/resend in Resend before claiming live bounce/delivery callbacks. Do not reveal or paste secrets into chat.

## Verification
Focused isolated DB/HTTP/account-email/signature checkpoint: 15 passed, 0 failed before final UI-only refinement. Type checks and production bundle passed. Browser preview confirmed unread transition and exact Design survey draft opening. In-app browser viewport override did not change its actual 1280x720 size; genuine mobile emulation remains to be completed. Gmail/Outlook/Apple Mail rendering and inbox/spam/reply checks require real client access and are not claimed.

## Operational constraints
No new paid worker/service. Current single-instance worker uses the existing web process, database locking and persistent queues; can later move to a dedicated worker without changing event semantics. Reminders use elapsed hours, not a business-hours calendar. Returned/rejected instructions are reviewed inside the authorized document to avoid emailing confidential financial remarks. Recipient administration uses existing role/assignment management, rather than independent permission overrides.
