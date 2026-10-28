-- Explicit identities joining imported positioning to an existing approved IPO.
-- This never creates an IPO, replays a delivery, reserves stock or posts money.
CREATE TABLE inventory_material_source_links (
 id uuid PRIMARY KEY,
 board_site_id text NOT NULL UNIQUE REFERENCES operations_board_sites(id),
 board_version integer NOT NULL,
 ipo_id uuid NOT NULL UNIQUE REFERENCES internal_purchase_orders(id),
 boq_revision_id uuid NOT NULL REFERENCES boq_revisions(id),
 board_sha256 text NOT NULL CHECK(board_sha256 ~ '^[a-f0-9]{64}$'),
 ipo_sha256 text NOT NULL CHECK(ipo_sha256 ~ '^[a-f0-9]{64}$'),
 boq_sha256 text NOT NULL CHECK(boq_sha256 ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 request_key uuid NOT NULL UNIQUE,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(board_site_id,board_version) REFERENCES operations_board_versions(site_id,version)
);
CREATE TRIGGER immutable_inventory_material_source_link BEFORE UPDATE OR DELETE ON inventory_material_source_links FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
