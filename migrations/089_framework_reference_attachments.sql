-- Reference evidence only: never becomes a new order's confirmation evidence.
CREATE TABLE framework_reference_attachments (
 id uuid PRIMARY KEY,
 framework_id uuid NOT NULL REFERENCES project_framework_versions(id),
 filename text NOT NULL,
 mime text NOT NULL CHECK (mime='application/pdf'),
 content bytea NOT NULL,
 sha256 text NOT NULL,
 summary jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(framework_id,sha256)
);
