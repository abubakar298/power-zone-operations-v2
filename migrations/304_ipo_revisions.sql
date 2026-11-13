-- IPO revision (phase 1). An issued IPO is never edited: a revision runs through a revised
-- quotation (commercial route: same BOQ) or a revised BOQ and quotation (technical route), then a
-- proposed new IPO version (-R1, -R2 ...) that Management approves after seeing the reason and the
-- old and new IPO. Approval issues the new version as its own immutable IPO and hands it to Accounts.
CREATE TABLE ipo_revision_requests (
 id uuid PRIMARY KEY,
 record_id uuid NOT NULL REFERENCES project_workflow_records(id),
 base_ipo_id uuid NOT NULL REFERENCES internal_purchase_orders(id),
 sequence integer NOT NULL CHECK(sequence>0),
 route text NOT NULL CHECK(route IN('commercial','technical')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 quotation_revision_request_id uuid NOT NULL UNIQUE REFERENCES quotation_revision_requests(id),
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(record_id,sequence)
);
CREATE TABLE ipo_revision_proposals (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES ipo_revision_requests(id),
 version integer NOT NULL CHECK(version>0),
 quotation_id uuid NOT NULL REFERENCES quotation_versions(id),
 number text NOT NULL CHECK(length(btrim(number))>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 request_key uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,version)
);
CREATE TABLE ipo_revision_decisions (
 proposal_id uuid PRIMARY KEY REFERENCES ipo_revision_proposals(id),
 decision text NOT NULL CHECK(decision IN('Approved','Returned')),
 note text NOT NULL,
 revised_ipo_id uuid UNIQUE REFERENCES internal_purchase_orders(id),
 request_key uuid NOT NULL UNIQUE,
 decided_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((decision='Approved')=(revised_ipo_id IS NOT NULL)),
 CHECK(decision='Approved' OR length(btrim(note))>=3)
);
CREATE INDEX ipo_revision_requests_record ON ipo_revision_requests(record_id);
CREATE INDEX ipo_revision_proposals_request ON ipo_revision_proposals(request_id);
CREATE TRIGGER immutable_ipo_revision_request BEFORE UPDATE OR DELETE ON ipo_revision_requests FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_ipo_revision_proposal BEFORE UPDATE OR DELETE ON ipo_revision_proposals FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_ipo_revision_decision BEFORE UPDATE OR DELETE ON ipo_revision_decisions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

INSERT INTO notification_types(kind,title,email_enabled) VALUES
 ('IPO revision approval required','IPO revision approval required',false),
 ('IPO revision approved','IPO revision approved',false),
 ('IPO revision returned','IPO revision returned',false),
 ('Revised IPO issued','Revised IPO issued',false)
ON CONFLICT(kind) DO NOTHING;

ALTER VIEW notification_events RENAME TO before_ipo_revision_events;
CREATE VIEW notification_events AS SELECT * FROM before_ipo_revision_events
UNION ALL
SELECT 'ipo-revision-proposal:'||p.id,'ipo-revision:'||q.id,'IPO revision approval required',
 left(concat_ws(' | ',p.number,r.site_name,'Reason: '||q.reason),1000),p.created_by,p.created_at,NULL::uuid,'management'::text,
 jsonb_build_object('target','dashboard','kind','IPO revision','proposal_id',p.id),
 true
FROM ipo_revision_proposals p JOIN ipo_revision_requests q ON q.id=p.request_id JOIN project_workflow_records r ON r.id=q.record_id
-- Only undecided proposals: once Management decides, the event leaves and the bell item resolves.
WHERE NOT EXISTS(SELECT 1 FROM ipo_revision_decisions d WHERE d.proposal_id=p.id)
UNION ALL
SELECT 'ipo-revision-decision:'||d.proposal_id,'ipo-revision-decision:'||d.proposal_id,
 CASE WHEN d.decision='Approved' THEN 'IPO revision approved' ELSE 'IPO revision returned' END,
 left(concat_ws(' | ',p.number,r.site_name,CASE WHEN d.decision='Approved' THEN 'Issued and sent to Accounts' ELSE 'Returned: '||d.note END),1000),
 d.decided_by,d.created_at,q.created_by,'owner'::text,
 jsonb_build_object('target','coordination','kind','Project workflow','workflow_id',r.id,'id',r.id),false
FROM ipo_revision_decisions d JOIN ipo_revision_proposals p ON p.id=d.proposal_id JOIN ipo_revision_requests q ON q.id=p.request_id JOIN project_workflow_records r ON r.id=q.record_id
UNION ALL
SELECT 'ipo-revision-issued:'||d.proposal_id,'ipo-revision-issued:'||d.proposal_id,'Revised IPO issued',
 left(concat_ws(' | ',i.number,r.site_name,'Revises '||b.number,'Reason: '||q.reason),1000),
 d.decided_by,d.created_at,NULL::uuid,'Accounts'::text,
 jsonb_build_object('target','finance','kind','IPO issued','ipo_id',i.id),false
FROM ipo_revision_decisions d JOIN internal_purchase_orders i ON i.id=d.revised_ipo_id JOIN ipo_revision_proposals p ON p.id=d.proposal_id
 JOIN ipo_revision_requests q ON q.id=p.request_id JOIN internal_purchase_orders b ON b.id=q.base_ipo_id JOIN project_workflow_records r ON r.id=q.record_id;
