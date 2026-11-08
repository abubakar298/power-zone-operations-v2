-- A verified QC source snapshot replaces the old Inventory report prerequisite.
ALTER TABLE accounts_job_closures ALTER COLUMN report_version_id DROP NOT NULL;
ALTER TABLE accounts_job_closures ADD CONSTRAINT accounts_closure_material_source CHECK (
 report_version_id IS NOT NULL OR (
 snapshot->>'qcMaterialSignature' IS NOT NULL AND
 snapshot#>>'{qcMaterialSource,ready}'='true'
 ));
ALTER TABLE job_closure_evidence DROP CONSTRAINT job_closure_evidence_kind_check;
ALTER TABLE job_closure_evidence ADD CONSTRAINT job_closure_evidence_kind_check CHECK (
 kind IN('PT costing screenshot','Client acknowledgment','Site photographs','Signed DO','Variable items sign-off'));
