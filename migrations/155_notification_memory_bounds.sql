-- Preserve handoff rules; materialize only team and IPO identity, not full site snapshots.
CREATE OR REPLACE VIEW workflow_handoff_events AS
WITH policy AS (
 SELECT p.* FROM workflow_handoff_policy_current p JOIN users reviewer ON reviewer.id=p.reviewed_by AND reviewer.active AND reviewer.role IN('Admin','Management') WHERE p.enabled
), board AS (
 SELECT v.site_id,jsonb_build_object('operationsTeam',v.snapshot->>'operationsTeam','origin',jsonb_build_object('ipoId',v.snapshot->'origin'->>'ipoId')) AS snapshot FROM (SELECT DISTINCT ON(site_id) site_id,snapshot FROM operations_board_versions ORDER BY site_id,version DESC) v
), changes AS (
 SELECT e.*,v.action,v.reason,v.snapshot->>'ipo' AS ipo,v.snapshot->>'name' AS site_name,
 v.snapshot->>'operationsTeam' AS team,v.snapshot->>'completed' AS completed,old.snapshot->>'completed' AS before_completed,
 v.snapshot->'documents' AS documents,old.snapshot->'documents' AS before_documents,
 v.snapshot->'planningBatches'->-1->'stops'->0->>'kind' AS last_stop_kind,v.snapshot->'planningBatches'->-1->>'kind' AS last_batch_kind
 FROM operations_board_events e
 JOIN policy p ON e.created_at>=p.activated_at
 JOIN operations_board_versions v ON v.site_id=e.site_id AND v.version=e.site_version
 LEFT JOIN operations_board_versions old ON old.site_id=v.site_id AND old.version=v.version-1
), material_sites AS (
 SELECT d.id,d.number,d.warehouse,coalesce(posting.posted_at,d.created_at) AS created_at,coalesce(posting.posted_by,d.created_by) AS created_by,s.value AS site,b.site_id,b.snapshot AS board_snapshot
 FROM inventory_material_dispatches d LEFT JOIN inventory_signed_dispatch_pending pending ON pending.document_kind='dispatch' AND pending.document_id=d.id LEFT JOIN inventory_signed_dispatch_postings posting ON posting.document_kind=pending.document_kind AND posting.document_id=pending.document_id JOIN policy p ON coalesce(posting.posted_at,d.created_at)>=p.activated_at AND (pending.document_id IS NULL OR posting.document_id IS NOT NULL)
 CROSS JOIN LATERAL jsonb_array_elements(d.snapshot->'sites') s
 LEFT JOIN board b ON CASE WHEN s.value->>'registeredSiteId' IS NOT NULL THEN b.site_id=s.value->>'registeredSiteId'
 ELSE b.site_id=s.value->>'siteId' OR b.snapshot->'origin'->>'ipoId'=s.value->>'siteId' END
), events AS (
 SELECT 'ipo:'||i.id AS key,'IPO issued to Accounts'::text AS kind,i.number AS reference,i.created_by AS actor_id,i.created_at,'accounts'::text AS recipient,NULL::text AS team,NULL::text AS site_id,
 jsonb_build_object('path','/accounts/ipos') AS target
 FROM internal_purchase_orders i JOIN policy p ON i.created_at>=p.activated_at
 UNION ALL
 SELECT 'assignment:'||c.id,'Project assigned',concat_ws(' | ',c.ipo,c.site_name),c.created_by,c.created_at,'leads',c.team,c.site_id,
 jsonb_build_object('path','/operations/sites/'||replace(replace(replace(c.site_id,'%','%25'),':','%3A'),'/','%2F'))
 FROM changes c WHERE c.action='assign-team'
 UNION ALL
 SELECT 'plan:'||c.id||':'||r.recipient,'Dispatch plan saved',concat_ws(' | ',c.ipo,c.site_name),c.created_by,c.created_at,r.recipient,c.team,c.site_id,
 CASE WHEN r.recipient='inventory' THEN jsonb_build_object('path','/inventory/parent-dos') ELSE jsonb_build_object('path','/operations/sites/'||replace(replace(replace(c.site_id,'%','%25'),':','%3A'),'/','%2F')) END
 FROM changes c CROSS JOIN (VALUES('inventory'),('qc')) r(recipient)
 WHERE (c.kind IN('Dispatch plan','Batch plan','Batch plan changed') OR c.action='plan')
 AND (r.recipient<>'inventory' OR c.kind NOT IN('Batch plan','Batch plan changed') OR COALESCE(c.last_stop_kind,c.last_batch_kind,'both')<>'labour')
 UNION ALL
 SELECT 'site:'||c.id,CASE WHEN c.completed='true' AND COALESCE(c.before_completed,'false')<>'true' THEN 'Site completed' ELSE 'Physical document update' END,
 concat_ws(' | ',c.kind,c.ipo,c.site_name,CASE WHEN c.action LIKE 'Document movement:%' THEN c.reason::jsonb->>'location' END),c.created_by,c.created_at,'accounts',c.team,c.site_id,
 jsonb_build_object('path','/accounts/documents')
 FROM changes c WHERE c.action LIKE 'Document movement:%' OR COALESCE(c.documents,'[]'::jsonb) IS DISTINCT FROM COALESCE(c.before_documents,'[]'::jsonb)
 OR (c.completed='true' AND COALESCE(c.before_completed,'false')<>'true')
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

CREATE INDEX notification_email_ready ON notification_email_queue(next_attempt_at,id) WHERE state='queued';
CREATE INDEX notification_inbox_keyset ON notifications(user_id,created_at DESC,id DESC);
