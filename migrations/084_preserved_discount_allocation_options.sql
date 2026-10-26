-- Preserve both implementations; no quotation, IPO, price or engineering master is rewritten.
CREATE TABLE ipo_discount_allocation_policy_versions (
 version integer PRIMARY KEY CHECK(version>0), policy jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ipo_discount_allocation_policy_immutable BEFORE UPDATE OR DELETE ON ipo_discount_allocation_policy_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
INSERT INTO ipo_discount_allocation_policy_versions(version,policy) VALUES(1,'{"active":"legacy-after-tax","beforeTax":"preserved-deferred-director-review","incompatibleAcceptedQuotation":"pause-IPO-with-explicit-reason","historicalSnapshots":"never-rewrite"}');
