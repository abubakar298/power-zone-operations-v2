-- Only 0999 is a shared construction code. Site identity remains a separate FK.
DROP INDEX project_workflow_active_site;
CREATE UNIQUE INDEX project_workflow_active_site ON project_workflow_records(customer_id,lower(site_code)) WHERE stage NOT IN('issued','declined') AND site_code<>'0999';
CREATE UNIQUE INDEX project_workflow_active_construction_site ON project_workflow_records(customer_id,site_id) WHERE stage NOT IN('issued','declined') AND site_code='0999';
