-- Stock, reservations, vendors and procurement for site operations.
-- No stock ledger (Moaz, 15 Oct 2026): Store keeps a hand-entered count per item; every count is
-- kept as history. Reservations hold quantities for a site until released or dispatched.

CREATE TABLE stock_counts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_key text NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK (quantity >= 0),
 note text NOT NULL DEFAULT '',
 counted_by uuid NOT NULL REFERENCES users(id),
 counted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_counts_item ON stock_counts(item_key, counted_at DESC);
CREATE TRIGGER immutable_stock_counts BEFORE UPDATE OR DELETE ON stock_counts
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

CREATE TABLE stock_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 execution_id uuid NOT NULL REFERENCES site_execution_records(id),
 item_key text NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
 note text NOT NULL DEFAULT '',
 reserved_by uuid NOT NULL REFERENCES users(id),
 reserved_at timestamptz NOT NULL DEFAULT now(),
 released_by uuid REFERENCES users(id),
 released_at timestamptz,
 release_reason text NOT NULL DEFAULT ''
);
CREATE INDEX stock_reservations_open ON stock_reservations(item_key) WHERE released_at IS NULL;
CREATE INDEX stock_reservations_site ON stock_reservations(execution_id);
CREATE OR REPLACE FUNCTION protect_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.execution_id <> OLD.execution_id OR NEW.item_key <> OLD.item_key OR NEW.quantity <> OLD.quantity
    OR NEW.note <> OLD.note OR NEW.reserved_by <> OLD.reserved_by OR NEW.reserved_at <> OLD.reserved_at
    OR OLD.released_at IS NOT NULL THEN
  RAISE EXCEPTION 'A reservation can only be released once; nothing else changes';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_stock_reservations BEFORE UPDATE ON stock_reservations FOR EACH ROW EXECUTE FUNCTION protect_reservation();
CREATE TRIGGER no_delete_stock_reservations BEFORE DELETE ON stock_reservations FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

CREATE TABLE vendors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) > 0),
 category text NOT NULL CHECK (category IN ('Structure','Delivery','Electrical labour','Earthing','Material supplier')),
 regions text[] NOT NULL DEFAULT '{}',
 contact_person text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vendors_name_category ON vendors(lower(btrim(name)), category);

CREATE TABLE site_vendor_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 execution_id uuid NOT NULL REFERENCES site_execution_records(id),
 category text NOT NULL CHECK (category IN ('Structure','Delivery','Electrical labour','Earthing','Material supplier')),
 vendor_id uuid NOT NULL REFERENCES vendors(id),
 agreed_date date,
 notes text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 removed_by uuid REFERENCES users(id),
 removed_at timestamptz
);
CREATE UNIQUE INDEX site_vendor_assignments_active ON site_vendor_assignments(execution_id, category) WHERE removed_at IS NULL;
CREATE OR REPLACE FUNCTION protect_vendor_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.execution_id <> OLD.execution_id OR NEW.category <> OLD.category OR NEW.vendor_id <> OLD.vendor_id
    OR NEW.agreed_date IS DISTINCT FROM OLD.agreed_date OR NEW.notes <> OLD.notes OR NEW.created_by <> OLD.created_by
    OR NEW.created_at <> OLD.created_at OR OLD.removed_at IS NOT NULL THEN
  RAISE EXCEPTION 'A vendor assignment can only be removed; assign again to change it';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_site_vendor_assignments BEFORE UPDATE ON site_vendor_assignments FOR EACH ROW EXECUTE FUNCTION protect_vendor_assignment();
CREATE TRIGGER no_delete_site_vendor_assignments BEFORE DELETE ON site_vendor_assignments FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

CREATE TABLE procurement_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 execution_id uuid REFERENCES site_execution_records(id),
 item_key text,
 service_category text CHECK (service_category IN ('Structure','Delivery','Electrical labour','Earthing','Material supplier')),
 description text NOT NULL CHECK (length(btrim(description)) > 0),
 quantity numeric(20,6) CHECK (quantity > 0),
 unit text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'Not started' CHECK (status IN ('Not started','Quoted','Ordered','Received','Cancelled')),
 vendor_id uuid REFERENCES vendors(id),
 expected_date date,
 amount numeric(20,2) CHECK (amount >= 0),
 notes text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (item_key IS NOT NULL OR service_category IS NOT NULL)
);
CREATE INDEX procurement_requests_status ON procurement_requests(status, created_at);
CREATE INDEX procurement_requests_site ON procurement_requests(execution_id);

CREATE TABLE procurement_request_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES procurement_requests(id),
 from_status text,
 to_status text,
 changes jsonb NOT NULL DEFAULT '{}'::jsonb,
 note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX procurement_request_events_request ON procurement_request_events(request_id, created_at);
CREATE TRIGGER immutable_procurement_request_events BEFORE UPDATE OR DELETE ON procurement_request_events
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Site history gains the new event kinds.
ALTER TABLE site_execution_events DROP CONSTRAINT site_execution_events_kind_check;
ALTER TABLE site_execution_events ADD CONSTRAINT site_execution_events_kind_check CHECK (kind IN (
 'stage_change','field_update','photo_check','problem_added','problem_resolved',
 'reservation','reservation_released','vendor_assigned','vendor_removed','procurement'));
