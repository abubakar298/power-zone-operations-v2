-- Inverter, battery and BMS watch for Abu Bakar (Moaz, 24 Oct 2026). Hamza does not buy these items, so Abu Bakar
-- is alerted when the coming sites need more than Store has and has on order, and records his own orders here.
ALTER TABLE purchase_requests ADD COLUMN kind text NOT NULL DEFAULT 'purchase' CHECK (kind IN ('purchase','direct'));
ALTER TABLE purchase_requests ADD COLUMN vendor text NOT NULL DEFAULT '';
ALTER TABLE purchase_requests ADD COLUMN expected_on date;

-- Per item: days from order to arrival, and stock to keep in hand.
CREATE TABLE stock_watch_settings (
 item_key text PRIMARY KEY REFERENCES item_master(key),
 lead_days integer NOT NULL DEFAULT 30 CHECK (lead_days BETWEEN 0 AND 365),
 min_stock numeric(20,6) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- The last level seen for each item, so an alert goes out only when a shortage appears or grows.
CREATE TABLE stock_watch_state (
 item_key text PRIMARY KEY,
 level text NOT NULL CHECK (level IN ('ok','on_order','plan','urgent')),
 short numeric(20,6) NOT NULL DEFAULT 0,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stock_watch_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('shortage','summary','overdue')),
 user_id uuid NOT NULL REFERENCES users(id),
 reference text NOT NULL,
 details jsonb NOT NULL DEFAULT '[]'::jsonb,
 order_id uuid REFERENCES purchase_requests(id),
 day date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_watch_summary_once ON stock_watch_alerts(user_id, day) WHERE kind = 'summary';
CREATE UNIQUE INDEX stock_watch_overdue_once ON stock_watch_alerts(user_id, order_id) WHERE kind = 'overdue';
CREATE TRIGGER immutable_stock_watch_alerts BEFORE UPDATE OR DELETE ON stock_watch_alerts
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Alerts reach Abu Bakar's bell and the existing email queue, the same way 091 added technical reports.
ALTER VIEW notification_events RENAME TO before_stock_watch_events;
CREATE VIEW notification_events AS
 SELECT * FROM before_stock_watch_events
 UNION ALL
 SELECT 'stock-watch:'||a.id, 'stock-watch:'||a.kind, 'Stock shortage', a.reference, NULL::uuid, a.created_at,
 a.user_id, 'owner', jsonb_build_object('target','stock-watch'), false
 FROM stock_watch_alerts a;
INSERT INTO notification_types(kind, title, email_enabled) VALUES ('Stock shortage', 'Inverter, battery & BMS shortage', true);
