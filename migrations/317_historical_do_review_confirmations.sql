-- Old (historical) DOs can carry a review note, for example "CPZ-DO-812 also lists one 60×60 duct ...
-- Confirm their source before verifying usage." Until now nothing in the app could clear that note,
-- so QC could never verify usage and the site stayed in "Completed Jobs Awaiting QC".
-- Owner rule (27 November 2026): the Inventory head confirms the note with a reason; QC can then verify.
-- A confirmation covers the exact note text (review_hash): a changed note needs a fresh confirmation.
-- Append-only: nothing is updated or deleted.
CREATE TABLE inventory_historical_review_confirmations (
 site_id text NOT NULL CHECK(length(btrim(site_id))>0),
 review_hash text NOT NULL CHECK(review_hash ~ '^[a-f0-9]{64}$'),
 review text NOT NULL CHECK(length(btrim(review))>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
 request_key uuid NOT NULL UNIQUE,
 confirmed_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,review_hash)
);
CREATE TRIGGER immutable_inventory_historical_review_confirmation BEFORE UPDATE OR DELETE ON inventory_historical_review_confirmations FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
