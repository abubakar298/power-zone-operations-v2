-- Internal cost and markup are kept outside the customer quotation snapshot.
CREATE TABLE quotation_additional_inputs (
  quotation_id uuid PRIMARY KEY REFERENCES quotation_versions(id),
  input jsonb NOT NULL
);
CREATE TRIGGER immutable_quotation_additional_inputs BEFORE UPDATE OR DELETE ON quotation_additional_inputs FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
