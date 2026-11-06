-- Owner-reviewed recipients and a forward-only activation cutoff. No historical email replay.
CREATE TABLE workflow_handoff_policy_versions (
 version integer PRIMARY KEY CHECK(version>0), enabled boolean NOT NULL,
 activated_at timestamptz NOT NULL, reviewed_by uuid NOT NULL REFERENCES users(id),
 request_key uuid NOT NULL UNIQUE,
 recipients jsonb NOT NULL CHECK(jsonb_typeof(recipients)='object'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_workflow_handoff_policy BEFORE UPDATE OR DELETE ON workflow_handoff_policy_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE VIEW workflow_handoff_policy_current AS SELECT * FROM workflow_handoff_policy_versions ORDER BY version DESC LIMIT 1;
-- This source view is also re-evaluated by bell reads and the sender: a saved notice never grants access.
CREATE VIEW workflow_handoff_events AS
WITH policy AS (
 SELECT p.* FROM workflow_handoff_policy_current p JOIN users reviewer ON reviewer.id=p.reviewed_by AND reviewer.active AND reviewer.role IN('Admin','Management') WHERE p.enabled
), board AS (
 SELECT DISTINCT ON(site_id) site_id,snapshot FROM operations_board_versions ORDER BY site_id,version DESC
), changes AS (
 SELECT e.*,v.snapshot,v.action,v.reason,old.snapshot AS before_snapshot FROM operations_board_events e
 JOIN policy p ON e.created_at>=p.activated_at
 JOIN operations_board_versions v ON v.site_id=e.site_id AND v.version=e.site_version
 LEFT JOIN operations_board_versions old ON old.site_id=v.site_id AND old.version=v.version-1
), material_sites AS (
 SELECT d.id,d.number,d.warehouse,d.created_at,d.created_by,s.value AS site,b.site_id,b.snapshot AS board_snapshot
 FROM inventory_material_dispatches d JOIN policy p ON d.created_at>=p.activated_at
 CROSS JOIN LATERAL jsonb_array_elements(d.snapshot->'sites') s
 LEFT JOIN board b ON CASE WHEN s.value->>'registeredSiteId' IS NOT NULL THEN b.site_id=s.value->>'registeredSiteId'
 ELSE b.site_id=s.value->>'siteId' OR b.snapshot->'origin'->>'ipoId'=s.value->>'siteId' END
), events AS (
 SELECT 'ipo:'||i.id AS key,'IPO issued to Accounts'::text AS kind,i.number AS reference,i.created_by AS actor_id,i.created_at,'accounts'::text AS recipient,NULL::text AS team,NULL::text AS site_id,
 jsonb_build_object('path','/accounts/ipos') AS target
 FROM internal_purchase_orders i JOIN policy p ON i.created_at>=p.activated_at
 UNION ALL
 SELECT 'assignment:'||c.id,'Project assigned',concat_ws(' | ',c.snapshot->>'ipo',c.snapshot->>'name'),c.created_by,c.created_at,'leads',c.snapshot->>'operationsTeam',c.site_id,
 jsonb_build_object('path','/operations/sites/'||replace(replace(replace(c.site_id,'%','%25'),':','%3A'),'/','%2F'))
 FROM changes c WHERE c.action='assign-team'
 UNION ALL
 SELECT 'plan:'||c.id||':'||r.recipient,'Dispatch plan saved',concat_ws(' | ',c.snapshot->>'ipo',c.snapshot->>'name'),c.created_by,c.created_at,r.recipient,c.snapshot->>'operationsTeam',c.site_id,
 CASE WHEN r.recipient='inventory' THEN jsonb_build_object('path','/inventory/parent-dos') ELSE jsonb_build_object('path','/operations/sites/'||replace(replace(replace(c.site_id,'%','%25'),':','%3A'),'/','%2F')) END
 FROM changes c CROSS JOIN (VALUES('inventory'),('qc')) r(recipient)
 WHERE (c.kind IN('Dispatch plan','Batch plan','Batch plan changed') OR c.action='plan')
 AND (r.recipient<>'inventory' OR c.kind NOT IN('Batch plan','Batch plan changed') OR COALESCE(c.snapshot->'planningBatches'->-1->'stops'->0->>'kind',c.snapshot->'planningBatches'->-1->>'kind','both')<>'labour')
 UNION ALL
 SELECT 'site:'||c.id,CASE WHEN c.snapshot->>'completed'='true' AND COALESCE(c.before_snapshot->>'completed','false')<>'true' THEN 'Site completed' ELSE 'Physical document update' END,
 concat_ws(' | ',c.kind,c.snapshot->>'ipo',c.snapshot->>'name',CASE WHEN c.action LIKE 'Document movement:%' THEN c.reason::jsonb->>'location' END),c.created_by,c.created_at,'accounts',c.snapshot->>'operationsTeam',c.site_id,
 jsonb_build_object('path','/accounts/documents')
 FROM changes c WHERE c.action LIKE 'Document movement:%' OR COALESCE(c.snapshot->'documents','[]'::jsonb) IS DISTINCT FROM COALESCE(c.before_snapshot->'documents','[]'::jsonb)
 OR (c.snapshot->>'completed'='true' AND COALESCE(c.before_snapshot->>'completed','false')<>'true')
 UNION ALL
 SELECT 'dispatch:'||m.id||':'||COALESCE(m.site->>'siteId',m.site->>'id','site')||':'||r.recipient,'Material dispatched',concat_ws(' | ',m.number,m.site->>'ipo',m.site->>'siteName'),m.created_by,m.created_at,r.recipient,m.board_snapshot->>'operationsTeam',m.site_id,
 CASE WHEN r.recipient='accounts' THEN jsonb_build_object('path','/accounts/inventory') ELSE jsonb_build_object('path','/operations/sites/'||replace(replace(replace(m.site_id,'%','%25'),':','%3A'),'/','%2F')) END
 FROM material_sites m CROSS JOIN(VALUES('accounts'),('qc')) r(recipient)
 UNION ALL
 SELECT 'gate:'||g.id||':'||COALESCE(m.site->>'siteId',m.site->>'id','site')||':'||r.recipient,CASE WHEN g.copy_kind='signed-gate' THEN 'Signed gate DO saved' ELSE 'Physical document update' END,concat_ws(' | ',m.number,m.site->>'ipo',m.site->>'siteName'),g.created_by,g.created_at,r.recipient,m.board_snapshot->>'operationsTeam',m.site_id,
 CASE WHEN r.recipient='accounts' THEN jsonb_build_object('path','/accounts/documents') ELSE jsonb_build_object('path','/operations/sites/'||replace(replace(replace(m.site_id,'%','%25'),':','%3A'),'/','%2F')) END
 FROM inventory_gate_pass_copies g JOIN policy p ON g.created_at>=p.activated_at
 JOIN inventory_material_dispatches d ON g.document_kind='dispatch' AND g.document_id=d.id
 CROSS JOIN LATERAL jsonb_array_elements(d.snapshot->'sites') s
 LEFT JOIN board b ON CASE WHEN s.value->>'registeredSiteId' IS NOT NULL THEN b.site_id=s.value->>'registeredSiteId' ELSE b.site_id=s.value->>'siteId' OR b.snapshot->'origin'->>'ipoId'=s.value->>'siteId' END
 -- The dispatch may predate activation: attaching its new signed copy still counts as new work.
 CROSS JOIN LATERAL(SELECT d.id,d.number,s.value AS site,b.site_id,b.snapshot AS board_snapshot) m
 CROSS JOIN(VALUES('accounts'),('qc')) r(recipient)
 WHERE g.copy_kind='signed-gate' OR r.recipient='accounts'
 UNION ALL
 SELECT 'irr:'||v.id,'Physical document update',concat_ws(' | ','IRR / reconciliation: '||v.stage,r.job_key),v.created_by,v.created_at,'accounts',NULL,NULL,
 jsonb_build_object('path','/accounts/inventory')
 FROM inventory_report_versions v JOIN inventory_reports r ON r.id=v.report_id JOIN policy p ON v.created_at>=p.activated_at
 UNION ALL
 SELECT 'closure:'||c.id,'Closure approval required',c.job_key,c.created_by,c.created_at,'management',NULL,NULL,
 jsonb_build_object('path','/accounts/closure-review')
 FROM accounts_job_closures c JOIN policy p ON c.created_at>=p.activated_at WHERE c.stage='Awaiting Management'
)
SELECT 'handoff:'||e.key||':'||u.id AS source_key,'handoff:'||e.key AS entity_key,e.kind,e.reference,e.actor_id,e.created_at,
 u.id AS owner_id,'assigned'::text AS audience,e.target,false AS actionable
FROM events e CROSS JOIN policy p JOIN users u ON u.active AND COALESCE(p.recipients->e.recipient,'[]'::jsonb) ? u.id::text
LEFT JOIN operations_board_access a ON a.user_id=u.id
LEFT JOIN operations_board_qc_delegations q ON q.user_id=u.id AND q.team=a.team AND q.revoked_at IS NULL AND (q.expires_at IS NULL OR q.expires_at>now())
LEFT JOIN users grantor ON grantor.id=q.granted_by AND grantor.active AND grantor.role IN('Admin','Management')
LEFT JOIN board current_site ON current_site.site_id=e.site_id
WHERE (e.recipient='accounts' AND u.role='Accounts')
 OR (e.recipient='inventory' AND u.role='Inventory' AND EXISTS(SELECT 1 FROM inventory_material_access access WHERE access.user_id=u.id AND access.capability='dispatcher'))
 OR (e.recipient='management' AND u.role IN('Admin','Management'))
 OR (e.recipient='leads' AND u.role='Operations' AND a.kind='lead' AND a.team=e.team AND current_site.snapshot->>'operationsTeam'=e.team)
 OR (e.recipient='qc' AND u.role='Operations' AND e.team IN('central','south') AND a.team=e.team AND current_site.snapshot->>'operationsTeam'=e.team
 AND (a.kind='qc' OR (a.kind='lead' AND grantor.id IS NOT NULL)));
ALTER VIEW notification_events RENAME TO before_workflow_handoff_events;
CREATE VIEW notification_events AS
 SELECT * FROM before_workflow_handoff_events e WHERE NOT(e.source_key LIKE 'accounts:%' AND EXISTS(SELECT 1 FROM workflow_handoff_policy_current p WHERE p.enabled AND e.created_at>=p.activated_at))
 UNION ALL SELECT * FROM workflow_handoff_events;
INSERT INTO notification_types(kind,title,email_enabled) VALUES
 ('Project assigned','Project assigned to Operations Lead',true),('IPO issued to Accounts','IPO issued to Accounts',true),('Dispatch plan saved','Dispatch plan saved',true),
 ('Material dispatched','Material dispatched',true),('Signed gate DO saved','Signed gate DO saved',true),
 ('Site completed','Site completed',true),('Physical document update','Physical document update',true),
 ('Closure approval required','Closure approval required',true);
