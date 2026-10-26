-- Additive communication state. Workflow records and snapshots remain untouched.
CREATE TABLE notification_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 activated_at timestamptz NOT NULL DEFAULT now(), email_enabled boolean NOT NULL DEFAULT false,
 reminders_enabled boolean NOT NULL DEFAULT false, reminder_hours integer NOT NULL DEFAULT 48 CHECK(reminder_hours BETWEEN 4 AND 720)
);
INSERT INTO notification_settings(singleton) VALUES(true);
CREATE TABLE notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id), email_enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE notifications (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), source_key text NOT NULL,
 entity_key text NOT NULL, kind text NOT NULL, title text NOT NULL, reference text NOT NULL,
 actor_id uuid REFERENCES users(id), target jsonb NOT NULL, actionable boolean NOT NULL,
 created_at timestamptz NOT NULL, read_at timestamptz, resolved_at timestamptz,
 UNIQUE(user_id,source_key)
);
CREATE INDEX notification_inbox ON notifications(user_id,created_at DESC);
CREATE TABLE notification_email_queue (
 id uuid PRIMARY KEY REFERENCES notifications(id), state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','sent','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), provider_id text,
 last_error text, delivered_at timestamptz
);
-- Reference-only projection: never include costing, markup, snapshots or free-text remarks.
CREATE VIEW notification_events AS
 SELECT 'quote:'||e.id AS source_key,'quote:'||q.id AS entity_key,e.kind AS kind,
 concat_ws(' | ',q.snapshot->'customer'->>'name',q.snapshot->>'siteName',q.number) AS reference,e.created_by AS actor_id,e.created_at,
 d.owner_id AS owner_id,CASE WHEN e.kind='Submitted' THEN 'management' ELSE 'owner' END AS audience,
 jsonb_build_object('target','quotes','kind','Sale confirmation','id',q.id) AS target,
 e.kind IN('Submitted','Changes requested') AS actionable
 FROM coordination_events e JOIN quotation_versions q ON q.id=e.quotation_id
 JOIN boqs b ON b.id=(SELECT boq_id FROM boq_revisions WHERE id=q.boq_revision_id)
 JOIN survey_drafts d ON d.id=b.draft_id
 WHERE e.kind<>'Changes requested' OR NOT EXISTS(SELECT 1 FROM quotation_revision_requests r WHERE r.source_quotation_id=q.id)
 UNION ALL
 SELECT 'cni:'||a.id,'cni:'||p.id,a.action,concat_ws(' | ',v.snapshot->'customer'->>'name',v.snapshot->>'siteName',v.number),a.created_by,a.created_at,p.created_by,
 CASE WHEN a.action='Approval requested' THEN 'management' ELSE 'owner' END,
 jsonb_build_object('target','quotes','kind','C&I proposal','id',p.id),a.action IN('Approval requested','Revision requested')
 FROM cni_proposal_actions a JOIN cni_proposal_versions v ON v.id=a.version_id JOIN cni_proposals p ON p.id=v.proposal_id
 UNION ALL
 SELECT 'revision:'||r.id,'quote:'||q.id,'Revision requested',concat_ws(' | ',q.snapshot->'customer'->>'name',q.snapshot->>'siteName',q.number),r.created_by,r.created_at,d.owner_id,'owner',
 jsonb_build_object('target',CASE WHEN r.costing_change THEN 'boqs' ELSE 'pricing' END,'kind','Quotation revision','id',r.id,'draft_id',r.draft_id,'boq_revision_id',q.boq_revision_id,'request_id',r.id),true
 FROM quotation_revision_requests r JOIN quotation_versions q ON q.id=r.source_quotation_id JOIN boq_revisions b ON b.id=q.boq_revision_id JOIN boqs bo ON bo.id=b.boq_id JOIN survey_drafts d ON d.id=bo.draft_id
 UNION ALL
 SELECT 'ipo:'||s.id,'ipo:'||s.id,'IPO approval required',COALESCE(s.snapshot->>'quotationNumber','IPO'),s.created_by,s.created_at,s.created_by,'management',
 jsonb_build_object('target','orders','kind','IPO evidence','id',s.id),true FROM ipo_submissions s
 UNION ALL
 SELECT 'issued:'||i.id,'ipo:'||i.submission_id,'IPO approved',i.number,i.created_by,i.created_at,s.created_by,'owner',
 jsonb_build_object('target','orders','kind','Operations issuance','ipo_id',i.id,'id',i.id),false FROM internal_purchase_orders i JOIN ipo_submissions s ON s.id=i.submission_id
 UNION ALL
 SELECT 'design:'||h.id,'draft:'||h.draft_id,'Work assigned',COALESCE(h.inputs->>'siteName','Survey'),h.created_by,h.created_at,h.assigned_to,'owner',
 jsonb_build_object('target','boqs','kind','Survey / BOQ','draft_id',h.draft_id,'id',h.draft_id),true FROM design_survey_handoffs h
 UNION ALL
 SELECT 'accounts:'||h.id,'accounts:'||h.ipo_id,'Departmental handoff',i.number,h.created_by,h.created_at,NULL::uuid,'Accounts',
 jsonb_build_object('target','finance','kind','Accounts handoff','ipo_id',i.id,'id',i.id),false FROM ipo_accounts_handoffs h JOIN internal_purchase_orders i ON i.id=h.ipo_id
 UNION ALL
 SELECT 'operations:'||o.id,'operations:'||o.ipo_id,'Departmental handoff',o.number,o.created_by,o.created_at,NULL::uuid,'Operations',
 jsonb_build_object('target','operations','kind','Operations handoff','ipo_id',o.ipo_id,'id',o.id),false FROM operations_boq_issuances o
 UNION ALL
 SELECT 'security:'||a.id,'security:'||a.id,'Security',
 CASE a.action WHEN 'account.reset.completed' THEN 'Password changed' WHEN 'account.role.changed' THEN 'Account access changed' WHEN 'account.sessions.revoked' THEN 'Account sessions ended' ELSE 'Account activated' END,
 a.user_id,a.created_at,a.target_user_id,'security',jsonb_build_object('target','account','kind','Security'),false
 FROM audit_log a WHERE a.target_user_id IS NOT NULL AND a.action IN('account.reset.completed','account.role.changed','account.sessions.revoked','account.activated');
CREATE TABLE notification_types (
 kind text PRIMARY KEY, email_enabled boolean NOT NULL DEFAULT true,
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 100),
 critical boolean NOT NULL DEFAULT false
);
INSERT INTO notification_types(kind,title,email_enabled) VALUES
 ('Submitted','Quotation approval required',true),('Approval requested','Quotation approval required',true),
 ('Approved','Quotation approved',false),('Changes requested','Revision requested',true),
 ('PO received','Customer confirmation received',false),('Revision requested','Revision requested',true),
 ('IPO approval required','IPO approval required',true),('IPO approved','IPO approved',false),
 ('Work assigned','New work assigned',true),('Departmental handoff','Departmental handoff',true),
 ('Reminder','Action overdue',true),('Escalation','Overdue work requires attention',true);
INSERT INTO notification_types(kind,title,critical) VALUES('Security','Account security update',true);
ALTER TABLE notifications ADD COLUMN parent_id uuid REFERENCES notifications(id);
CREATE TABLE notification_admin_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE notification_email_queue ADD COLUMN provider_status text;
ALTER TABLE email_outbox ADD COLUMN provider_status text;
CREATE TABLE notification_webhook_receipts(id text PRIMARY KEY,event_type text NOT NULL,received_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX notification_entity_pending ON notifications(entity_key,created_at) WHERE resolved_at IS NULL;
