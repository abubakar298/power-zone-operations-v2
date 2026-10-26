-- Additive master route engine. Historical costing, IPOs and departmental records are untouched.
CREATE TABLE project_framework_versions (
 id uuid PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id),
 configuration_key text NOT NULL, version integer NOT NULL CHECK(version>0),
 payload jsonb NOT NULL, source_reference text NOT NULL,
 approved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(customer_id,configuration_key,version)
);
CREATE VIEW project_framework_current AS SELECT DISTINCT ON(customer_id,configuration_key) * FROM project_framework_versions ORDER BY customer_id,configuration_key,version DESC;
CREATE TABLE project_workflow_records (
 id uuid PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id), site_id integer REFERENCES sites(id),
 site_name text NOT NULL, site_code text NOT NULL, region text NOT NULL DEFAULT '',
 route text NOT NULL CHECK(route IN('survey-quote','quick-quote','survey-framework','direct-framework')),
 stage text NOT NULL, coordinator_id uuid NOT NULL REFERENCES users(id), planning_owner_id uuid REFERENCES users(id), technical_owner_id uuid REFERENCES users(id),
 framework_id uuid REFERENCES project_framework_versions(id), version integer NOT NULL DEFAULT 1,
 data jsonb NOT NULL DEFAULT '{}', legacy_type text, legacy_id uuid,
 request_key uuid NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(legacy_type,legacy_id)
);
CREATE UNIQUE INDEX project_workflow_active_site ON project_workflow_records(customer_id,lower(site_code)) WHERE stage NOT IN('issued','declined');
CREATE TABLE project_workflow_events (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES project_workflow_records(id), version integer NOT NULL,
 action text NOT NULL, snapshot jsonb NOT NULL, request_key uuid UNIQUE NOT NULL,
 input_fingerprint text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(record_id,version)
);
CREATE TABLE project_workflow_documents (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES project_workflow_records(id), kind text NOT NULL,
 version integer NOT NULL, number text NOT NULL, snapshot jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(record_id,kind,version)
);
CREATE TABLE project_workflow_files (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES project_workflow_records(id), kind text NOT NULL,
 filename text NOT NULL, mime text NOT NULL CHECK(mime IN('application/pdf','image/png','image/jpeg')),
 sha256 text NOT NULL, content bytea NOT NULL CHECK(octet_length(content)>0 AND octet_length(content)<=8388608),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(record_id,kind,sha256)
);
CREATE TABLE project_po_receipts (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES project_workflow_records(id), customer_id integer NOT NULL REFERENCES customers(id),
 reference text NOT NULL, version integer NOT NULL, input jsonb NOT NULL, basis jsonb NOT NULL,
 differences jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(record_id,version)
);
CREATE INDEX project_po_reference ON project_po_receipts(customer_id,lower(reference));
CREATE TABLE project_order_decisions (
 id uuid PRIMARY KEY, receipt_id uuid NOT NULL REFERENCES project_po_receipts(id), record_id uuid NOT NULL REFERENCES project_workflow_records(id),
 outcome text NOT NULL CHECK(outcome IN('Matched','Approved exception','Returned')),
 reason text NOT NULL, authorised_basis jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_workflow_issuances (
 record_id uuid PRIMARY KEY REFERENCES project_workflow_records(id), receipt_id uuid UNIQUE NOT NULL REFERENCES project_po_receipts(id),
 decision_id uuid REFERENCES project_order_decisions(id), ipo_id uuid UNIQUE NOT NULL REFERENCES internal_purchase_orders(id),
 operations_id uuid UNIQUE NOT NULL REFERENCES operations_boq_issuances(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_advance_planning (
 record_id uuid PRIMARY KEY REFERENCES project_workflow_records(id), mode text NOT NULL CHECK(mode IN('Provisional','Confirmed')),
 document_id uuid NOT NULL REFERENCES project_workflow_documents(id), operations_owner_id uuid NOT NULL REFERENCES users(id),
 confirmed_issuance_id uuid REFERENCES operations_boq_issuances(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_workflow_owner ON project_workflow_records(coordinator_id,planning_owner_id,technical_owner_id,stage);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['project_framework_versions','project_workflow_events','project_workflow_documents','project_workflow_files','project_po_receipts','project_order_decisions','project_workflow_issuances'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation()',t,t);
 END LOOP;
END $$;
-- Seed from approved immutable database evidence, never a UI or an arbitrary new selling figure.
INSERT INTO project_framework_versions(id,customer_id,configuration_key,version,payload,source_reference)
SELECT gen_random_uuid(),c.id,h.configuration_id||':'||h.stage,1,
 jsonb_build_object('type','ubl-solar','configuration',h.configuration_id,'pricingStage',h.stage,'routes',jsonb_build_array('survey-framework','direct-framework'),
 'commercial',h.snapshot,'budget',b.snapshot,'technical',t.snapshot,'allocationSource',d.snapshot,
 'terms',jsonb_build_object('payment','As approved customer PO / framework agreement'),'invoiceCompany','PZES (PVT Ltd)'),
 'Approved UBL price history / frozen cost and technical version'
FROM ubl_commercial_history h JOIN customers c ON lower(c.short_code)='ubl' AND c.status='Active'
JOIN LATERAL(SELECT snapshot FROM ubl_cost_revisions WHERE configuration_id=h.configuration_id AND stage=h.stage ORDER BY version DESC LIMIT 1)b ON true
JOIN LATERAL(SELECT snapshot FROM ubl_technical_versions WHERE configuration_id=h.configuration_id ORDER BY version DESC LIMIT 1)t ON true
LEFT JOIN LATERAL(SELECT snapshot FROM ubl_site_document_versions WHERE snapshot->>'configuration_id'=h.configuration_id AND snapshot->>'pricing_stage'=h.stage ORDER BY version DESC LIMIT 1)d ON true;
INSERT INTO project_framework_versions(id,customer_id,configuration_key,version,payload,source_reference)
SELECT gen_random_uuid(),c.id,e.key,1,
 jsonb_build_object('type','bank-ups','configuration',e.payload->>'configuration','profile',e.payload,'profileKey',e.key,'profileVersion',e.version,
 'routes',jsonb_build_array('direct-framework','survey-framework'),'terms',jsonb_build_object('payment',CASE WHEN upper(c.short_code)='UBL' THEN '50% advance' ELSE 'As approved customer PO / framework agreement' END),'invoiceCompany','PZES (PVT Ltd)'),e.payload->>'source'
FROM engineering_profiles_current e JOIN customers c ON upper(c.short_code)=e.payload->>'customerShortCode' AND c.status='Active'
WHERE e.key IN('UBL-UPS-6-10','MBL-UPS-6-5','MBL-UPS-6-10');
-- Bridge existing UBL records without modifying their original evidence, versions or snapshots.
INSERT INTO project_workflow_records(id,customer_id,site_id,site_name,site_code,region,route,stage,coordinator_id,planning_owner_id,technical_owner_id,framework_id,data,legacy_type,legacy_id,request_key,created_by,created_at,updated_at)
SELECT gen_random_uuid(),r.customer_id,r.site_id,r.site_name,COALESCE(s.code,r.branch_code,'UNCONFIRMED-'||r.source_row),COALESCE(r.source->'branch'->>'Region',''),'survey-framework',
 CASE WHEN r.stage='Confirmed BOQ issued' THEN 'issued' WHEN r.stage='Declined' THEN 'declined' WHEN r.stage='Deferred' THEN 'deferred'
 WHEN r.stage='Existing job—Revised PO pending' THEN 'po_receipt'
 WHEN r.stage LIKE 'Heads-up Received%' THEN 'advance_pending' WHEN r.stage LIKE 'Advance BOQ Sent%' THEN 'customer_tracking'
 WHEN r.stage LIKE 'PO Received%' OR r.stage LIKE 'IPO Submitted%' OR r.stage LIKE 'Accounts Accepted%' THEN 'po_receipt'
 WHEN r.stage LIKE 'Recommendations Submitted%' THEN 'customer_tracking' WHEN r.stage LIKE 'Recommendations—Pending%' THEN 'approved_dispatch'
 WHEN r.data->>'surveyStatus'='Completed' AND COALESCE((r.data->>'technicalVerified')::boolean,false)=false THEN 'report_received'
 WHEN r.data->>'surveyStatus' IN('Scheduled','In progress') THEN 'survey_scheduled' ELSE 'survey_requested' END,
 COALESCE((SELECT id FROM users WHERE active AND role='Coordinator' ORDER BY CASE WHEN display_name ILIKE '%atif%' THEN 0 ELSE 1 END,display_name LIMIT 1),r.created_by),
 (SELECT id FROM users WHERE id::text=r.data->>'planningOwnerId'),(SELECT id FROM users WHERE id::text=r.data->>'technicalOwnerId'),f.id,
 jsonb_build_object('legacyData',r.data,'legacySource',r.source,'legacyStage',r.stage,'scheduledSurveyDate',r.data->>'scheduledSurveyDate','notes',COALESCE(r.data->>'notes',''),'originalOrderPreserved',COALESCE((r.data->>'originalOrderPreserved')::boolean,false)),
 'ubl',r.id,gen_random_uuid(),r.created_by,r.created_at,r.updated_at
FROM ubl_workflow_requests r LEFT JOIN sites s ON s.id=r.site_id
LEFT JOIN project_framework_current f ON f.customer_id=r.customer_id AND f.configuration_key=(r.data->>'configuration')||':'||COALESCE(r.data->>'pricingStage','Revised');
-- Legacy Design handoffs remain real searchable records, without rewriting their evidence.
INSERT INTO project_workflow_records(id,customer_id,site_id,site_name,site_code,region,route,stage,coordinator_id,planning_owner_id,technical_owner_id,data,legacy_type,legacy_id,request_key,created_by,created_at,updated_at)
SELECT gen_random_uuid(),(d.inputs->>'customerId')::integer,s.id,d.inputs->>'siteName',d.inputs->>'siteCode',COALESCE(d.inputs->>'location',''),'survey-quote',CASE WHEN h.id IS NOT NULL THEN 'design_handed_off' ELSE 'technical_review' END,
 COALESCE(h.assigned_to,(SELECT id FROM users WHERE active AND role='Coordinator' ORDER BY CASE WHEN display_name ILIKE '%atif%' THEN 0 ELSE 1 END,created_at LIMIT 1)),d.owner_id,d.owner_id,
 jsonb_build_object('legacySurvey',d.inputs,'draftId',h.draft_id,'notes','Existing Design survey evidence preserved','designHandoffAt',h.created_at),'design',d.id,gen_random_uuid(),d.owner_id,d.created_at,d.updated_at
FROM design_surveys d LEFT JOIN design_survey_handoffs h ON h.survey_id=d.id LEFT JOIN sites s ON s.customer_id=(d.inputs->>'customerId')::integer AND lower(s.code)=lower(d.inputs->>'siteCode')
WHERE COALESCE(d.inputs->>'customerId','')~'^[1-9][0-9]*$' AND COALESCE(d.inputs->>'siteCode','')<>'' AND EXISTS(SELECT 1 FROM customers WHERE id=(d.inputs->>'customerId')::integer)
AND EXISTS(SELECT 1 FROM users WHERE active AND role='Coordinator')
AND NOT EXISTS(SELECT 1 FROM project_workflow_records r WHERE r.customer_id=(d.inputs->>'customerId')::integer AND lower(r.site_code)=lower(d.inputs->>'siteCode') AND r.stage NOT IN('issued','declined'));
-- Cost access is a named-person capability, not a department role.
CREATE TABLE restricted_cost_access(user_id uuid PRIMARY KEY REFERENCES users(id), granted_reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO restricted_cost_access(user_id,granted_reason)
SELECT id,'Owner-only restricted equipment cost access requested by Abu Bakar' FROM users
WHERE active AND role IN('Admin','Management') AND regexp_replace(lower(display_name),'[^a-z]','','g') IN('abubakar','abubakarsiddique');
