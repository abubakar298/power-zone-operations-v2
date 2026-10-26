# Survey and IPO adjustments — 7 October 2026

Owner instruction: measured surveys must supply AC cable quantities; the existing automatic allowances apply only to Quick BOQ / General quotation.

Survey and Design forms collect metres separately for inverter termination and panel termination, each with 16 mm² and 25 mm² 4-core options. The persisted survey retains all four measurements. Costing sums quantities of the same rate-master cable SKU and uses the existing rate. Zero means no quantity for that cable/purpose. Missing legacy measurements are not replaced with fixed survey allowances. Quick BOQ continues to use its existing single/dual-inverter formulas. Stored historical BOQ, costing, quotation and IPO snapshots are not modified. Revising an old survey requires reviewing its measured quantities.

Quotation PDF rendering uses the last server-validated quotation input. Clearing/retyping descriptions retains the last valid PDF; successful validation refreshes it, while an invalid input cannot be saved as a quotation. Discount behavior and saved historical versions remain unchanged.

IPO invoice-name entry is labelled Customer / company name on invoice, defaults from the customer database, and remains editable for a different legal billing name. Sales source is a dropdown: Sales team, Director referral, Existing customer, Customer referral, Website / online inquiry, Walk-in and Other. Existing historical free-text sources remain selectable when loaded. No delivery fields move into the coordinator form.

Verification: manual 16/25 mm² quantities and cost arithmetic, zero quantities, negative-quantity rejection, unchanged Quick BOQ allowances, clearing/retyping customer-facing descriptions followed by PDF reload, sales-source selection, and existing full workflow/history regressions. All tests use isolated data; no sample workflow is created in production.
