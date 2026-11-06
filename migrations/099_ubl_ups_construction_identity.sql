-- Only authenticated UBL UPS Direct PO creation marks the shared 0999 placeholder.
-- No business rows, PO references, IPO references or numbering counters are rewritten.
DROP INDEX project_workflow_active_site;
DROP INDEX project_workflow_active_construction_site;
CREATE UNIQUE INDEX project_workflow_active_site ON project_workflow_records(customer_id,lower(site_code))
WHERE stage NOT IN('issued','declined') AND NOT COALESCE(site_code='0999' AND route='direct-framework' AND data->>'sharedConstructionBranch'='UBL-UPS',false);
CREATE UNIQUE INDEX project_workflow_active_construction_site ON project_workflow_records(customer_id,site_id)
WHERE stage NOT IN('issued','declined') AND site_code='0999' AND route='direct-framework' AND data->>'sharedConstructionBranch'='UBL-UPS';
