-- Owner-confirmed retrospective DOs: documents were prepared after the team left.
-- Document/custody readiness only; no warehouse OUT is posted or replayed.
CREATE TABLE inventory_retrospective_dispatches (
 dispatch_id uuid PRIMARY KEY REFERENCES inventory_material_dispatches(id),
 dispatch_number text NOT NULL,
 warehouse text NOT NULL,
 reason text NOT NULL,
 authority text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_retrospective_dispatch BEFORE UPDATE OR DELETE ON inventory_retrospective_dispatches FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
INSERT INTO inventory_retrospective_dispatches(dispatch_id,dispatch_number,warehouse,reason,authority)
 SELECT d.id,d.number,d.warehouse,
 'Prepared after the team had already left. Gate/customer DO copies are unavailable; customer acknowledgment and VSO remain required. This exception does not post stock.',
 'Owner instruction, 1 November 2026: six existing software DOs'
 FROM inventory_material_dispatches_active d
 JOIN (VALUES
 ('CPZ-DO-26-0001','Multan warehouse'),
 ('CPZ-DO-26-0002','Multan warehouse'),
 ('CPZ-DO-26-0004','Multan warehouse'),
 ('CPZ-DO-26-0005','Multan warehouse'),
 ('CPZ-DO-26-0006','Lahore warehouse'),
 ('CPZ-PDO-26-0001','Lahore warehouse')
 ) approved(number,warehouse) ON approved.number=d.number AND approved.warehouse=d.warehouse
 WHERE d.created_at >= '2026-10-30T00:00:00Z' AND d.created_at < '2026-10-31T00:00:00Z';
