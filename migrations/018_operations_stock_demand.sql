ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles ADD CONSTRAINT roles_name_check CHECK(name IN('Admin','Management','Employee','Coordinator','Operations'));
INSERT INTO roles(name) VALUES('Operations');
CREATE TABLE operations_stock_demand (
 issuance_id uuid NOT NULL REFERENCES operations_boq_issuances(id),
 line_number integer NOT NULL CHECK(line_number>=0),
 item_key text NOT NULL, brand text NOT NULL, specification text,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0), unit text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(issuance_id,line_number)
);
INSERT INTO operations_stock_demand(issuance_id,line_number,item_key,brand,specification,quantity,unit,created_at)
SELECT o.id,(l.ordinality-1)::integer,l.item->>'key',COALESCE(l.item->>'brand',''),l.item->>'specification',(l.item->>'qty')::numeric,l.item->>'unit',o.created_at
FROM operations_boq_issuances o CROSS JOIN LATERAL jsonb_array_elements(o.snapshot->'items') WITH ORDINALITY l(item,ordinality);
CREATE TRIGGER immutable_operations_stock_demand BEFORE UPDATE OR DELETE ON operations_stock_demand FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE store_boq_issuances (
 id uuid PRIMARY KEY, issuance_id uuid UNIQUE NOT NULL REFERENCES operations_boq_issuances(id),
 delivery_plan_id uuid NOT NULL REFERENCES operations_delivery_plans(id),
 number text UNIQUE NOT NULL, snapshot jsonb NOT NULL,
 request_key uuid UNIQUE NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_store_boq_issuance BEFORE UPDATE OR DELETE ON store_boq_issuances FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
