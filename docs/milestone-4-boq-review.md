# Milestone 4 — Costing review and BOQ revisions

A preparer saves a survey draft, calculates costing and submits the exact preview for review. Submission preserves an immutable snapshot, master versions, source references and revision reason. Pending drafts are locked. Admin and Management can request changes with required comments or approve; Employee can submit and edit their own drafts. Role and account activity are checked again at decision time. Self-approval is allowed for the owner/admin workflow.

Changes requested releases the draft for editing. Saving increments its version; resubmission creates another immutable review record, retaining earlier feedback and costing. Approval atomically saves the submitted snapshot, review decision, BOQ identity/revision, source links and audit entries. It never recalculates using newer rates. Repeated concurrent approval returns the same saved revision. Direct legacy Save cannot bypass review.

New site numbering occurs on approval: customer short code / site / 001 / R0. Existing saved BOQs remain unchanged. Create revision draft copies the latest approved survey and its source documents, retains customer/site/sequence and requires a revision reason. Approval appends R1, R2, etc. A competing revision based on an outdated approved version is rejected without recording an approval. History opens each original snapshot and PDF. Database triggers prevent rewriting review submissions, decisions, finalized drafts and BOQ revisions.

Authorized reviewers can download submitted costing PDFs and source documents. Other employees cannot access another preparer's pending submission or documents. Saved BOQ visibility continues the existing authenticated staff policy.

Commercial pricing and quotations are the next milestone and must reference the exact approved BOQ revision. No margins, quotations, inventory or email-provider activation are added here. Reviewed production rates and owner specification corrections remain untouched.

Validation: native PostgreSQL integration checks cover Employee/Management permissions, fresh role changes, source access, required feedback, locked drafts, stale previews, immutable snapshots, concurrent approval, R0/R1/R2 identity/history and outdated revision conflicts. Chromium smoke covers login, uploads/OCR review, PDF, changes requested, edit/resubmit/approve, revision history and persistent sessions across restart.
