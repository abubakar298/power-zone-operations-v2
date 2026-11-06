CREATE TABLE document_commercial_contract_versions (
 version integer PRIMARY KEY, approved_date date NOT NULL, contract jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_document_commercial_contract BEFORE UPDATE OR DELETE ON document_commercial_contract_versions FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
INSERT INTO document_commercial_contract_versions(version,approved_date,contract) VALUES(1,'2026-10-12','{
 "saleTypes":["Tax Deal","Cash Deal"],
 "cashTreatments":["Included in selling price","No GST added"],
 "cashInvoiceCompany":"Energy Solutions",
 "cashGstPayable":"0.00",
 "cashMarkupBasis":"full retained selling price minus cost",
 "taxMarkupBasis":"selling excluding GST minus cost",
 "ipo":{"layoutVersion":3,"columns":["Description","Qty","Unit","Rate excluding GST","Amount excluding GST"],"totals":["Subtotal excluding GST","Solar GST","Installations GST","Grand total including GST"],"preparedBy":"Atif","checkedBy":"Atif","costsVisible":false},
 "pt":{"columns":["PT phase","Item ID and quantity description","Selling value"],"bessSubtotal":true,"costsVisible":false,"cashSeparateTax":false,"epcItemId":"CH-EPC","structureItemId":"CH-Structure"},
 "historicalPolicy":"Existing snapshots, UBL budgets and closures remain immutable"
}'::jsonb);
