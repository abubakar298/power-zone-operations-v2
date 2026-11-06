# Milestone 5 — New BOQ starting experience

Existing engineering, costing, draft persistence and duplicate-request protection are reused. No schema or financial policy changes.

Customer/site context precedes family selection. Survey and Quick BOQ expose their existing applicable inputs; Design handoffs retain their input method. BESS and Direct Product selectors now offer text filtering without changing stored IDs or selected equipment. Switching to C&I preserves customer/site context; a Project Workspace can start a BOQ for its site. Draft editing and global navigation use the existing unsaved-changes guard. Cancelled navigation retains the form.

Focused verification: client typecheck/build passed. `scripts/new-boq-start-check.mjs` passed against disposable API fixtures: four families, context order, Survey/Quick fields, product/BESS search, cancelled navigation, C&I context, mobile containment and no writes. Existing server draft/idempotency checks are reserved for Milestone 7 integration.
