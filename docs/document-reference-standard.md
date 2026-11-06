# Approved document references

Owner approved 9 October 2026. New records only; existing references and historical snapshots are unchanged.

Format: `CPZ-TYPE-YY-SEQUENCE-CUSTOMER-SITE[-R#] (SHORT-SITECODE)`.
Example: `CPZ-QT-26-001-0003-003-R1 (BAFL-3432)`.

Customer code uses the permanent Customer Master numeric ID, padded to at least four digits. Site number is a stable per-customer ordinal, padded to at least three digits, stored in an additive identity registry. Existing maintained sites are ordered by their existing numeric ID to initialize the registry; master rows are not edited. New site codes receive the next ordinal. The customer short ID and supplied site code appear in parentheses. Revisions preserve the original root, including its year and sequence.

Every document type has a company-wide yearly counter using Pakistan time. Numbers are allocated in the business save transaction, not at preview. Retry-safe roots and transaction locks prevent duplicate numbers; failed saves roll back the allocation. Padding grows beyond 999 rather than truncating. First quotation version is R1; subsequent saved immutable versions increment the displayed revision across the same BOQ family, including technical BOQ revisions. Internal database version counters and authorization remain unchanged.

Current integration: BOQ save/revision, Solar Hybrid/BESS Only/Direct Product quotation save and Management-created quotations, C&I proposal/revision (QT), IPO issue, submitted Design survey report (SSR), Operations/Store BOQ issuances (BOQ). Commercial pricing versions are internal calculation records, not a separate owner-defined document type. Customer PO references remain external references supplied by the customer.

Reserved supported types: QT, BOQ, IPO, DO, INV, PO, SSR, TS, SR, IR, CR, AMC. Types without an existing document-creation module use the same allocator when their module is built; this change does not add those modules.

C&I creation now requires a site code. C&I cost confidentiality remains unchanged. Document links use UUIDs, not human reference strings. PDFs and email notifications reuse saved references. Download filenames sanitize unsafe characters where the existing export already does so.

Migration 032 is additive: sequence counters, immutable reference roots, immutable site identities and nullable Design survey number. No reset, reseed, deletion, tax change, pricing change or historical renumbering.
