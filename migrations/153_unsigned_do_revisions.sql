-- Preserve originals and all revisions. Only unsigned, unposted DOs can change.
CREATE TABLE inventory_material_dispatch_revisions (
 dispatch_id uuid NOT NULL REFERENCES inventory_material_dispatches(id),
 revision integer NOT NULL CHECK(revision>=2),
 action text NOT NULL CHECK(action IN('edit','delete')),
 before_record jsonb NOT NULL,
 before_lines jsonb NOT NULL,
 before_pending jsonb NOT NULL,
 after_snapshot jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>=3),
 request_key uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 PRIMARY KEY(dispatch_id,revision)
);
CREATE TRIGGER immutable_dispatch_revision BEFORE UPDATE OR DELETE ON inventory_material_dispatch_revisions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE FUNCTION guard_unsigned_do_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc uuid; permitted boolean;
BEGIN
 IF TG_TABLE_NAME='inventory_material_dispatches' THEN doc:=OLD.id;
 ELSIF TG_TABLE_NAME='inventory_signed_dispatch_pending' THEN doc:=OLD.document_id;
 ELSE doc:=OLD.dispatch_id; END IF;
 IF TG_TABLE_NAME='inventory_signed_dispatch_pending' THEN IF OLD.document_kind<>'dispatch' THEN RAISE EXCEPTION 'Issued warehouse documents are immutable'; END IF; END IF;
 SELECT EXISTS(SELECT 1 FROM inventory_material_dispatch_revisions r WHERE r.dispatch_id=doc AND r.transaction_id=txid_current()) INTO permitted;
 IF NOT permitted OR EXISTS(SELECT 1 FROM inventory_gate_pass_copies WHERE document_kind='dispatch' AND document_id=doc AND copy_kind='signed-gate') OR EXISTS(SELECT 1 FROM inventory_signed_dispatch_postings WHERE document_kind='dispatch' AND document_id=doc) OR EXISTS(SELECT 1 FROM inventory_warehouse_operational_movements WHERE dispatch_id=doc) THEN RAISE EXCEPTION 'Only an audited unsigned, unposted DO can be changed'; END IF;
 IF TG_TABLE_NAME='inventory_material_dispatches' AND TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancel DOs; preserve their history'; END IF;
 IF TG_TABLE_NAME='inventory_signed_dispatch_pending' AND TG_OP='DELETE' THEN RAISE EXCEPTION 'Preserve pending dispatch history'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER immutable_inventory_material_dispatch ON inventory_material_dispatches;
DROP TRIGGER immutable_inventory_material_dispatch_line ON inventory_material_dispatch_lines;
DROP TRIGGER immutable_signed_dispatch_pending ON inventory_signed_dispatch_pending;
CREATE TRIGGER audited_unsigned_dispatch BEFORE UPDATE OR DELETE ON inventory_material_dispatches FOR EACH ROW EXECUTE FUNCTION guard_unsigned_do_revision();
CREATE TRIGGER audited_unsigned_dispatch_line BEFORE UPDATE OR DELETE ON inventory_material_dispatch_lines FOR EACH ROW EXECUTE FUNCTION guard_unsigned_do_revision();
CREATE TRIGGER audited_unsigned_pending BEFORE UPDATE OR DELETE ON inventory_signed_dispatch_pending FOR EACH ROW EXECUTE FUNCTION guard_unsigned_do_revision();
CREATE VIEW inventory_material_dispatches_active AS SELECT * FROM inventory_material_dispatches WHERE coalesce(snapshot->>'cancelled','false')<>'true';
CREATE VIEW inventory_material_dispatch_lines_active AS SELECT l.* FROM inventory_material_dispatch_lines l JOIN inventory_material_dispatches_active d ON d.id=l.dispatch_id;
CREATE FUNCTION guard_unsigned_do_revision_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_doc inventory_material_dispatches; pending inventory_signed_dispatch_pending;
BEGIN
 SELECT * INTO pending FROM inventory_signed_dispatch_pending WHERE document_kind='dispatch' AND document_id=NEW.dispatch_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Only a pending unsigned DO can be revised'; END IF;
 SELECT * INTO current_doc FROM inventory_material_dispatches WHERE id=NEW.dispatch_id FOR UPDATE;
 IF coalesce(current_doc.snapshot->>'cancelled','false')='true' OR NEW.revision<>coalesce((current_doc.snapshot->>'doRevision')::integer,1)+1 OR NEW.before_record->'snapshot' IS DISTINCT FROM current_doc.snapshot OR NEW.before_pending->'movements' IS DISTINCT FROM pending.movements THEN RAISE EXCEPTION 'The DO revision changed or its audit snapshot is invalid'; END IF;
 IF EXISTS(SELECT 1 FROM inventory_gate_pass_copies WHERE document_kind='dispatch' AND document_id=NEW.dispatch_id AND copy_kind='signed-gate') OR EXISTS(SELECT 1 FROM inventory_signed_dispatch_postings WHERE document_kind='dispatch' AND document_id=NEW.dispatch_id) OR EXISTS(SELECT 1 FROM inventory_warehouse_operational_movements WHERE dispatch_id=NEW.dispatch_id) THEN RAISE EXCEPTION 'The signed DO is locked'; END IF;
 NEW.transaction_id:=txid_current();RETURN NEW;
END $$;
CREATE TRIGGER validated_unsigned_do_revision BEFORE INSERT ON inventory_material_dispatch_revisions FOR EACH ROW EXECUTE FUNCTION guard_unsigned_do_revision_insert();
