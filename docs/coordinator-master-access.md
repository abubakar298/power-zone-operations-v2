# Coordinator master access

Authorised by Abu Bakar on 7 October 2026: the Coordinator role (including Atif) can create customers and edit existing sites, buying rates, and item technical specifications/statuses. Existing customer edits, brands, engineering rules and team access remain Admin-only.

Customer creation is available under Master data → Customers and beside the customer selector in both surveyed and general BOQ forms. Inline creation selects the new customer and preserves the unsaved site form.

The API and database transaction both enforce the same permission policy. The transaction checks the current active user and role, so an old session cannot retain revoked write access. CSRF protection, validation, duplicate customer-code rejection, stale-version conflict checks, immutable rate/specification history and actor audit entries remain in place. Existing BOQ and quotation snapshots are never rewritten by master changes.

Site edits update the site master only. Previously saved documents retain their original snapshot details. Item editing uses the established specification/status editor; it does not add or rename engineering item keys.

Verification covers Coordinator-authorised writes, denied engineering-rule/brand/customer-update writes, duplicate customer codes, stale site edits, CSRF, current-role revocation and immutable history. Browser checks cover master controls and inline customer creation without losing unsaved site details, alongside the existing milestone regression flows.
