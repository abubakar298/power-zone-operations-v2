-- Actual cable usage against the BOQ, and items used outside the quotation.
-- Any cable variance is flagged (Moaz, 15 Oct 2026): extra cable charged is refunded, extra cable used is invoiced.

CREATE TABLE site_cable_usage (
 execution_id uuid NOT NULL REFERENCES site_execution_records(id),
 item_key text NOT NULL,
 used_qty numeric(20,6) NOT NULL CHECK (used_qty >= 0),
 returned_qty numeric(20,6) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
 note text NOT NULL DEFAULT '',
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (execution_id, item_key)
);

CREATE TABLE site_additional_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 execution_id uuid NOT NULL REFERENCES site_execution_records(id),
 item_key text,
 description text NOT NULL CHECK (length(btrim(description)) > 0),
 quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
 unit text NOT NULL DEFAULT '',
 reason text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 removed_by uuid REFERENCES users(id),
 removed_at timestamptz,
 removal_reason text NOT NULL DEFAULT ''
);
CREATE INDEX site_additional_items_site ON site_additional_items(execution_id) WHERE removed_at IS NULL;
CREATE OR REPLACE FUNCTION protect_additional_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.execution_id <> OLD.execution_id OR NEW.item_key IS DISTINCT FROM OLD.item_key OR NEW.description <> OLD.description
    OR NEW.quantity <> OLD.quantity OR NEW.unit <> OLD.unit OR NEW.reason <> OLD.reason OR NEW.created_by <> OLD.created_by
    OR NEW.created_at <> OLD.created_at OR OLD.removed_at IS NOT NULL THEN
  RAISE EXCEPTION 'An additional item can only be withdrawn; add a new line to correct it';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_site_additional_items BEFORE UPDATE ON site_additional_items FOR EACH ROW EXECUTE FUNCTION protect_additional_item();
CREATE TRIGGER no_delete_site_additional_items BEFORE DELETE ON site_additional_items FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

ALTER TABLE site_execution_events DROP CONSTRAINT site_execution_events_kind_check;
ALTER TABLE site_execution_events ADD CONSTRAINT site_execution_events_kind_check CHECK (kind IN (
 'stage_change','field_update','photo_check','problem_added','problem_resolved',
 'reservation','reservation_released','vendor_assigned','vendor_removed','procurement',
 'cable_usage','additional_item','additional_item_removed'));
