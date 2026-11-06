-- Temporary tracking copies are never stock transactions.
CREATE SEQUENCE inventory_temporary_document_number_seq;
CREATE TABLE inventory_temporary_documents (
 id uuid PRIMARY KEY,
 version integer NOT NULL CHECK(version>0),
 number text NOT NULL UNIQUE,
 warehouse text NOT NULL,
 snapshot jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_temporary_document_versions (
 document_id uuid NOT NULL REFERENCES inventory_temporary_documents(id),
 version integer NOT NULL,
 snapshot jsonb NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 input jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_id,version)
);
CREATE TABLE inventory_transport_choices (
 warehouse text NOT NULL,
 kind text NOT NULL CHECK(kind IN('issuedTo','vehicle','driver')),
 value text NOT NULL,
 details text NOT NULL DEFAULT '',
 actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(warehouse,kind,value)
);
CREATE TABLE inventory_parent_reconciliation_versions (
 draft_id uuid NOT NULL REFERENCES inventory_material_drafts(id),
 version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN('waiting','management-review','closed')),
 snapshot jsonb NOT NULL,
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(draft_id,version)
);
CREATE TRIGGER immutable_inventory_parent_reconciliation_versions BEFORE UPDATE OR DELETE ON inventory_parent_reconciliation_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE inventory_parent_preparation_references (
 draft_id uuid PRIMARY KEY REFERENCES inventory_material_drafts(id),
 number text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
