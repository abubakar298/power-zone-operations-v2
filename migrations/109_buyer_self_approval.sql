-- Buyer self-approval (Moaz, 26 Oct 2026): Hamza may approve a purchase request himself. Abu Bakar (every approver)
-- and anyone Admin marks "notify" (Moaz) are told each time, in the bell and through the existing email queue.

-- A third Procurement capability, granted by Admin by exact email: told when the buyer approves himself.
ALTER TABLE procurement_access DROP CONSTRAINT procurement_access_capability_check;
ALTER TABLE procurement_access ADD CONSTRAINT procurement_access_capability_check CHECK (capability IN ('buyer','approver','notify'));
ALTER TABLE procurement_access_events DROP CONSTRAINT procurement_access_events_capability_check;
ALTER TABLE procurement_access_events ADD CONSTRAINT procurement_access_events_capability_check CHECK (capability IN ('buyer','approver','notify'));

ALTER TABLE purchase_requests ADD COLUMN self_approved boolean NOT NULL DEFAULT false;

CREATE TABLE procurement_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('self_approved')),
 user_id uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL REFERENCES purchase_requests(id),
 reference text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, request_id, kind)
);
CREATE TRIGGER immutable_procurement_notices BEFORE UPDATE OR DELETE ON procurement_notices
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Notices reach the recipient's bell and email the same way 091 and 104 added theirs. The audience is the
-- recipient's own role, so it works whatever their role is; rows are inserted for the recipient only.
ALTER VIEW notification_events RENAME TO before_procurement_notice_events;
CREATE VIEW notification_events AS
 SELECT * FROM before_procurement_notice_events
 UNION ALL
 SELECT 'procurement-notice:'||n.id, 'purchase-request:'||n.request_id, 'Purchase self-approved', n.reference, NULL::uuid, n.created_at,
 n.user_id, u.role, jsonb_build_object('target','purchase-approvals','requestId',n.request_id), false
 FROM procurement_notices n JOIN users u ON u.id=n.user_id;
INSERT INTO notification_types(kind, title, email_enabled) VALUES ('Purchase self-approved', 'Purchase self-approved by the buyer', true);
