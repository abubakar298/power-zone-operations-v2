-- Attaching a signed gate/store copy is evidence only, never another stock IN/OUT.
CREATE TABLE inventory_gate_pass_copies (
 id uuid PRIMARY KEY,
 document_kind text NOT NULL CHECK(document_kind IN('dispatch','return','purchase')),
 document_id uuid NOT NULL,
 warehouse text NOT NULL,
 copy_kind text NOT NULL CHECK(copy_kind IN('signed-gate','signed-store')),
 evidence_id uuid NOT NULL REFERENCES inventory_material_evidence(id),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 2000),
 request_key uuid NOT NULL UNIQUE,
 fingerprint text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_kind,document_id,copy_kind,evidence_id)
);
CREATE INDEX inventory_gate_pass_copies_document ON inventory_gate_pass_copies(document_kind,document_id,created_at);
CREATE TRIGGER immutable_gate_pass_copy BEFORE UPDATE OR DELETE ON inventory_gate_pass_copies FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
