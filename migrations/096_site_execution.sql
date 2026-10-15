-- Site execution: the Operations lifecycle of a site after its IPO is issued.
-- One record per Operations issuance. Current state lives in site_execution_records
-- (updated in place, like project_workflow_records); every change is appended to
-- site_execution_events, which is immutable.
CREATE TABLE site_execution_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_key text NOT NULL UNIQUE,
 issuance_id uuid NOT NULL UNIQUE REFERENCES operations_boq_issuances(id),
 ipo_id uuid NOT NULL REFERENCES internal_purchase_orders(id),
 site_id integer REFERENCES sites(id),
 customer_id integer REFERENCES customers(id),
 stage text NOT NULL CHECK (stage IN (
  'ipo_received','material_planning','procurement','delivery_scheduled','dispatched',
  'installation','commissioning','documents','closed')),
 stage_entered_at timestamptz NOT NULL DEFAULT now(),
 site_type text CHECK (site_type IN ('Solar','BESS','Solar + BESS','UPS')),
 material_delivery_planned date,
 material_delivery_actual date,
 start_date date,
 end_date date,
 matri_cloud_status text CHECK (matri_cloud_status IN ('Connected','Not connected','N/A')),
 four_g_status text CHECK (four_g_status IN ('Connected','Not connected','N/A')),
 customer_signoff boolean,
 do_date date,
 acknowledgement_date date,
 submitted_to_customer_date date,
 advance_claimed boolean NOT NULL DEFAULT false,
 final_claimed boolean NOT NULL DEFAULT false,
 documents_note text NOT NULL DEFAULT '',
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
 CHECK (site_type IS DISTINCT FROM 'UPS' OR (matri_cloud_status IS NULL AND four_g_status IS NULL))
);
CREATE INDEX site_execution_records_stage ON site_execution_records(stage, stage_entered_at);

CREATE TABLE site_execution_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 execution_id uuid NOT NULL REFERENCES site_execution_records(id),
 kind text NOT NULL CHECK (kind IN ('stage_change','field_update','photo_check','problem_added','problem_resolved')),
 from_stage text,
 to_stage text,
 changes jsonb NOT NULL DEFAULT '{}'::jsonb,
 note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_execution_events_execution ON site_execution_events(execution_id, created_at);
CREATE TRIGGER immutable_site_execution_events BEFORE UPDATE OR DELETE ON site_execution_events
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- One row per calendar day between start and end: "Pictures for this date: yes / no". No uploads.
CREATE TABLE site_photo_checks (
 execution_id uuid NOT NULL REFERENCES site_execution_records(id),
 check_date date NOT NULL,
 pictures boolean NOT NULL,
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (execution_id, check_date)
);

-- Free-text problems. The text never changes; only the resolution is recorded later.
CREATE TABLE site_problems (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 execution_id uuid NOT NULL REFERENCES site_execution_records(id),
 problem text NOT NULL CHECK (length(btrim(problem)) > 0),
 status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Resolved')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_by uuid REFERENCES users(id),
 resolved_at timestamptz,
 resolution text NOT NULL DEFAULT ''
);
CREATE INDEX site_problems_execution ON site_problems(execution_id, created_at);
CREATE OR REPLACE FUNCTION protect_site_problem_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.problem <> OLD.problem OR NEW.execution_id <> OLD.execution_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
  RAISE EXCEPTION 'Problem text and origin are immutable; only the resolution may change';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_site_problems BEFORE UPDATE ON site_problems FOR EACH ROW EXECUTE FUNCTION protect_site_problem_text();
CREATE TRIGGER no_delete_site_problems BEFORE DELETE ON site_problems FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Back-fill: every existing Operations issuance gets a record. Stage is inferred from what
-- already happened (sent to Store = dispatched; delivery plan saved = delivery scheduled).
-- Site type comes from the BOQ family; direct-product sales are left for Operations to set.
INSERT INTO site_execution_records
 (job_key, issuance_id, ipo_id, site_id, customer_id, stage, stage_entered_at, site_type, created_at)
SELECT 'ipo:' || o.ipo_id, o.id, o.ipo_id, b.site_id, b.customer_id,
 CASE WHEN s.id IS NOT NULL THEN 'dispatched' WHEN p.id IS NOT NULL THEN 'delivery_scheduled' ELSE 'ipo_received' END,
 COALESCE(s.created_at, p.created_at, o.created_at),
 CASE COALESCE(r.snapshot->'survey'->>'family', 'solar-hybrid')
  WHEN 'solar-hybrid' THEN 'Solar + BESS' WHEN 'bess-only' THEN 'BESS' ELSE NULL END,
 o.created_at
FROM operations_boq_issuances o
JOIN boq_revisions r ON r.id = o.boq_revision_id
JOIN boqs b ON b.id = r.boq_id
LEFT JOIN store_boq_issuances s ON s.issuance_id = o.id
LEFT JOIN LATERAL (SELECT id, created_at FROM operations_delivery_plans WHERE issuance_id = o.id ORDER BY version DESC LIMIT 1) p ON true;
