# Power Zone workspace instructions

## Main items and descriptions: mandatory alignment rule

Owner instruction, 27 October 2026. Applies to every interface and module, including tables, lists, cards, forms and detail views.

- Keep primary labels, values and actions aligned in stable columns and on a consistent primary line.
- Put descriptions, helper text, notes and secondary metadata directly underneath their own main item.
- Adding, removing or wrapping secondary text must never move or vertically recenter the primary item or neighboring primary items.
- Use separate primary and secondary layout tracks, or top-aligned cells with a consistent primary-line height. Do not vertically center a combined primary-plus-description block within a row.
- Check rows with and without descriptions, including multiline descriptions, before calling the layout complete.

## Generated document compression: mandatory default

Owner instruction, 29 October 2026. Applies across the software and to future document formats.

- Compress every generated PDF by default, including all copies, downloads and print exports.
- Prefer selectable/vector text; when a page must be rasterized, use appropriately sized compressed images instead of uncompressed full-page PNGs.
- Preserve readable text, item IDs, signatures and stamps. Check actual exported file size and rendered pages.
- Typical four-copy business DOs should normally remain below 1–2 MB; investigate unusually large output rather than accepting 10–40 MB exports.
- Use the format’s normal compression for other generated document types; do not alter the content of uploaded signed evidence.

## Serial numbers on document lists: mandatory default

Owner instruction, 31 October 2026. Applies across the software, including PDF downloads and printed document variants.

- Every document containing a list of records or items must include an SR# column.
- Number the displayed rows in their final sort order, continuously across pages.
- Retain the SR# column when filters, document copies or export formats change.

## One-off fixes and hard-coded exceptions: mandatory default

Owner instruction, 20 November 2026. Applies across the software, including server, screens, shared code and scripts.

- Keep normal code general. Do not write specific site names, site codes, IPO numbers, record IDs or dates into normal business logic.
- Put a one-time data correction in its own clearly named file: a new migration, or a script in `server/maintenance/`. Never hide it inside normal code.
- Put a standing exception (a rule that applies only to certain records) in its own clearly named exceptions file, for example `shared/historical-closure-exceptions.ts`, never mixed into normal logic.
- Start every one-off fix or exception with a short note: what it fixes, the records it affects, the date, and who approved it (for example "Owner confirmation, 30 October 2026").
- Do not change, move or delete existing one-off fixes or exceptions, such as `server/inventory/owner-confirmations-20261030.ts` and `shared/historical-closure-exceptions.ts`, without the owner's approval. They are part of the audit trail.
