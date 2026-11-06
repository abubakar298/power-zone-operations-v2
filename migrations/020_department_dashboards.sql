ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles ADD CONSTRAINT roles_name_check CHECK(name IN('Admin','Management','Employee','Coordinator','Operations','Inventory','Accounts'));
INSERT INTO roles(name) VALUES('Inventory'),('Accounts');
CREATE TABLE department_checkpoints (
 id uuid PRIMARY KEY,
 department text NOT NULL CHECK(department IN('Inventory','Accounts')),
 store_issuance_id uuid REFERENCES store_boq_issuances(id),
 ipo_id uuid REFERENCES internal_purchase_orders(id),
 stage text NOT NULL,
 notes text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 request_key uuid UNIQUE NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((department='Inventory' AND store_issuance_id IS NOT NULL AND ipo_id IS NULL AND stage IN('Preparing stock','Ready for dispatch','Dispatched')) OR
 (department='Accounts' AND ipo_id IS NOT NULL AND store_issuance_id IS NULL AND stage IN('Review in progress','Awaiting documents')))
);
CREATE UNIQUE INDEX department_store_version ON department_checkpoints(store_issuance_id,version) WHERE store_issuance_id IS NOT NULL;
CREATE UNIQUE INDEX department_ipo_version ON department_checkpoints(ipo_id,version) WHERE ipo_id IS NOT NULL;
CREATE TRIGGER immutable_department_checkpoint BEFORE UPDATE OR DELETE ON department_checkpoints FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
