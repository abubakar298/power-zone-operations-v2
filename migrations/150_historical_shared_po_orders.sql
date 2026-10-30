-- Reviewed historical sites may share one real bank PO; existing PO rows stay unchanged.
ALTER TABLE customer_purchase_orders ADD COLUMN shared_order_number text CHECK(shared_order_number IS NULL OR shared_order_number ~ '^[1-9][0-9]{0,5}/[1-9][0-9]{0,5}$');
DROP INDEX customer_po_reference_unique;
CREATE UNIQUE INDEX customer_po_reference_unique ON customer_purchase_orders(customer_id,po_number) WHERE po_number<>'' AND shared_order_number IS NULL;
CREATE UNIQUE INDEX customer_po_shared_order_unique ON customer_purchase_orders(customer_id,po_number,shared_order_number) WHERE shared_order_number IS NOT NULL;
