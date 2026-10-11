-- Management-approved historical IPO/PT registration. No Accounts handoff or invoice mutation.
CREATE TABLE ubl_site_document_versions (
 site_id integer NOT NULL REFERENCES ubl_site_orders(site_id),
 version integer NOT NULL CHECK(version > 0),
 snapshot jsonb NOT NULL,
 registered_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,version)
);
CREATE TRIGGER immutable_ubl_site_document_versions BEFORE UPDATE OR DELETE ON ubl_site_document_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
-- Preserve the saved allocation proportions approved in the CHP-320 sample.
-- Current budget revisions remain separate; negotiated sites retain their 30/W cost baseline.
INSERT INTO ubl_site_document_versions(site_id,version,snapshot)
SELECT o.site_id,1,jsonb_build_object(
 'status','Historical registered','approvalReference','Approved by Abu Bakar in conversation, 11 October 2026',
 'site_name',o.site_name,'branch_code',o.branch_code,'region',o.region,'main_city',o.main_city,
 'legacy_ipo_number',o.legacy_ipo_number,'po_number',o.po_number,'po_issued_date',o.po_issued_date::text,
 'configuration_id',o.configuration_id,'pricing_stage',o.pricing_stage,
 'agreedWatts',split_part(o.configuration_id,'-',1)::integer*1000,
 'panelSellingRate',CASE WHEN o.pricing_stage='Revised' THEN 44 ELSE 33 END,
 'baseline',jsonb_set(o.baseline,'{commercialEvidence,panelSellingExcludingGst}',
 to_jsonb(((split_part(o.configuration_id,'-',1)::integer*1000)*(CASE WHEN o.pricing_stage='Revised' THEN 44 ELSE 33 END))::text)),
 'budgetSnapshot',e.baseline,
 'policy','IPO and PT remain fixed to agreed capacity. Verified IRR determines panel invoice allocation at the agreed rate; installations balance the approved total. Cable adjustments require separate authorization.'
)
FROM ubl_site_orders o JOIN ubl_effective_site_orders e ON e.site_id=o.site_id
WHERE o.status='Active';
DO $verify$ BEGIN
 IF (SELECT count(*) FROM ubl_site_document_versions)<>36 THEN
  RAISE EXCEPTION 'Expected 36 active historical UBL document registrations';
 END IF;
END $verify$;
