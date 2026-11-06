-- Forward-only: existing posted stock documents and balances remain unchanged.
CREATE TABLE inventory_signed_dispatch_pending (
 document_kind text NOT NULL CHECK(document_kind IN ('dispatch','transfer-out','replacement-out','replacement-in')),
 document_id uuid NOT NULL,
 warehouse text NOT NULL,
 source_sha256 text NOT NULL,
 authority_version integer NOT NULL CHECK(authority_version>0),
 movements jsonb NOT NULL CHECK(jsonb_typeof(movements)='array'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_kind,document_id)
);
CREATE TABLE inventory_signed_dispatch_postings (
 document_kind text NOT NULL,
 document_id uuid NOT NULL,
 evidence_id uuid NOT NULL REFERENCES inventory_material_evidence(id),
 posted_by uuid NOT NULL REFERENCES users(id),
 posted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_kind,document_id),
 FOREIGN KEY(document_kind,document_id) REFERENCES inventory_signed_dispatch_pending(document_kind,document_id)
);
CREATE TRIGGER immutable_signed_dispatch_pending BEFORE UPDATE OR DELETE ON inventory_signed_dispatch_pending FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TRIGGER immutable_signed_dispatch_postings BEFORE UPDATE OR DELETE ON inventory_signed_dispatch_postings FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

DO $$ BEGIN IF to_regclass('public.inventory_material_replacement_case_versions') IS NOT NULL THEN
 ALTER TABLE inventory_material_replacement_case_versions DROP CONSTRAINT inventory_material_replacement_case_versions_action_check;
 ALTER TABLE inventory_material_replacement_case_versions ADD CONSTRAINT inventory_material_replacement_case_versions_action_check CHECK(action IN('opened','replacement-out','faulty-return-held','faulty-return-awaiting-signed-igp','usable-release'));
END IF; END $$;
