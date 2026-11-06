-- Owner-requested reconciliation alert; no invoice or workflow mutation.
CREATE TABLE ubl_documentation_alerts (
 id text PRIMARY KEY,
 site_id integer NOT NULL REFERENCES ubl_site_orders(site_id),
 message text NOT NULL,
 status text NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Resolved')),
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ubl_documentation_alerts(id,site_id,message)
SELECT 'jatli-invoice-reconciliation-2026-10-11',site_id,
 'Invoice reconciliation discrepancy: recorded invoice incl. GST PKR 7,138,481.00; expected after cable adjustment PKR 7,130,692.70; recorded amount exceeds reconciliation by PKR 7,788.30. Cable adjustment incl. GST PKR -69,307.30. Internet excluded. Under review; do not deduct cable adjustments again or alter the invoice without authorization. Source: bulk IRR and invoice register supplied by Abu Bakar; reviewed 11 October 2026.'
FROM ubl_site_orders WHERE legacy_ipo_number='298';
