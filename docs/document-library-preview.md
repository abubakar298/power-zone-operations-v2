# Document library preview

Preview sits beside Open workflow. The read-only preview page displays the saved reference, customer/site, type and current task stage, with Back to documents and Download PDF. Existing list filters remain in place.

Saved BOQs use the existing authorized costing export (including role-based BESS redaction); saved quotations use their immutable single-page export and current workflow status; C&I proposals use their exact listed version with the existing draft/approved treatment; issued IPOs use the existing IPO/Peachtree export. All server authorization remains authoritative. No workflow mutations, recalculation, pricing, data migration or approval changes.

Unfinished survey drafts show saved survey fields rather than invented finalized costing. Their downloadable survey PDF excludes financial fields. A calculated BOQ remains available through normal workflow after preparation.

Shared DocumentPreview renders PDFs, preserving the current preview appearance. Preview/download share a fetched blob; object URLs are revoked on leaving. Load/authorization errors are shown and Download remains disabled when loading fails.

Verification: application typecheck and production client build PASS. Disposable browser fixtures PASS for five types, downloads, exact C&I version, GET-only behavior and 403 preventing download; no runtime errors. Full unrelated suites not manually repeated.
