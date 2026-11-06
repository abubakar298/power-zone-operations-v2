-- Site workflow: what Operations does with a site after its IPO is issued.
-- Stages (Moaz, 19 Oct 2026):
--   IPO received -> Under planning -> Delivery -> [installation & commissioning by us?]
--     yes: Installation -> Commissioning -> Handover -> Doc dispatch -> Closed
--     no:  Closed
-- One row per Operations issuance. Current state is updated in place; every change is
-- appended to site_workflow_events, which is immutable.
CREATE TABLE site_workflow (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 issuance_id uuid NOT NULL UNIQUE REFERENCES operations_boq_issuances(id),
 ipo_id uuid NOT NULL REFERENCES internal_purchase_orders(id),
 site_id integer REFERENCES sites(id),
 customer_id integer REFERENCES customers(id),
 stage text NOT NULL CHECK (stage IN (
  'ipo_received','planning','delivery','installation','commissioning','handover','doc_dispatch','closed')),
 stage_entered_at timestamptz NOT NULL DEFAULT now(),
 -- Decided at Delivery: do we also install and commission, or is this delivery only?
 scope text CHECK (scope IN ('installation','delivery_only')),
 site_type text CHECK (site_type IN ('Solar','BESS','Solar + BESS','UPS')),
 -- Under planning
 expected_start date,
 expected_delivery date,
 expected_completion date,
 -- Delivery
 delivered_on date,
 -- Installation
 started_on date,
 installation_completed_on date,
 -- Commissioning
 commissioned_on date,
 matri_cloud text CHECK (matri_cloud IN ('Connected','Not connected','N/A')),
 four_g text CHECK (four_g IN ('Connected','Not connected','N/A')),
 -- Handover
 handed_over_on date,
 customer_signoff boolean,
 -- Doc dispatch: UBL pays 50% on the DO and 50% on the branch manager's acknowledgement.
 do_date date,
 acknowledgement_date date,
 submitted_to_customer_date date,
 advance_claimed boolean NOT NULL DEFAULT false,
 final_claimed boolean NOT NULL DEFAULT false,
 documents_note text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (installation_completed_on IS NULL OR started_on IS NULL OR installation_completed_on >= started_on),
 CHECK (site_type IS DISTINCT FROM 'UPS' OR (matri_cloud IS NULL AND four_g IS NULL)),
 CHECK ((stage = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX site_workflow_stage ON site_workflow(stage, stage_entered_at);

CREATE TABLE site_workflow_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workflow_id uuid NOT NULL REFERENCES site_workflow(id),
 kind text NOT NULL CHECK (kind IN (
  'stage_forward','stage_back','field_update','pictures','problem_added','problem_resolved',
  'vendor_assigned','vendor_removed','cable_usage','additional_item','additional_item_withdrawn')),
 from_stage text,
 to_stage text,
 changes jsonb NOT NULL DEFAULT '{}'::jsonb,
 note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_workflow_events_workflow ON site_workflow_events(workflow_id, created_at);
CREATE TRIGGER immutable_site_workflow_events BEFORE UPDATE OR DELETE ON site_workflow_events
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Vendors chosen during planning, one active vendor per category per site.
CREATE TABLE site_workflow_vendors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) > 0),
 category text NOT NULL CHECK (category IN ('Structure','Delivery','Electrical labour','Earthing','Material supplier')),
 contact_person text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_workflow_vendors_name ON site_workflow_vendors(lower(btrim(name)), category);

CREATE TABLE site_workflow_vendor_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workflow_id uuid NOT NULL REFERENCES site_workflow(id),
 category text NOT NULL,
 vendor_id uuid NOT NULL REFERENCES site_workflow_vendors(id),
 agreed_date date,
 notes text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 removed_by uuid REFERENCES users(id),
 removed_at timestamptz,
 removal_reason text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX site_workflow_vendor_assignments_active ON site_workflow_vendor_assignments(workflow_id, category) WHERE removed_at IS NULL;
CREATE OR REPLACE FUNCTION site_workflow_assignment_remove_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workflow_id <> OLD.workflow_id OR NEW.category <> OLD.category OR NEW.vendor_id <> OLD.vendor_id
  OR NEW.agreed_date IS DISTINCT FROM OLD.agreed_date OR NEW.notes <> OLD.notes
  OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR OLD.removed_at IS NOT NULL THEN
  RAISE EXCEPTION 'A vendor assignment can only be removed, not edited';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER remove_only_site_workflow_vendor_assignments BEFORE UPDATE ON site_workflow_vendor_assignments
 FOR EACH ROW EXECUTE FUNCTION site_workflow_assignment_remove_only();
CREATE TRIGGER no_delete_site_workflow_vendor_assignments BEFORE DELETE ON site_workflow_vendor_assignments
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Installation: "Pictures for this date: yes / no", one row per day. No uploads.
CREATE TABLE site_workflow_picture_days (
 workflow_id uuid NOT NULL REFERENCES site_workflow(id),
 day date NOT NULL,
 pictures boolean NOT NULL,
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workflow_id, day)
);

-- Free-text problems. The text never changes; only the resolution is recorded later.
CREATE TABLE site_workflow_problems (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workflow_id uuid NOT NULL REFERENCES site_workflow(id),
 problem text NOT NULL CHECK (length(btrim(problem)) > 0),
 status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Resolved')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_by uuid REFERENCES users(id),
 resolved_at timestamptz,
 resolution text NOT NULL DEFAULT ''
);
CREATE INDEX site_workflow_problems_workflow ON site_workflow_problems(workflow_id, created_at);
CREATE OR REPLACE FUNCTION site_workflow_problem_text_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.problem <> OLD.problem OR NEW.workflow_id <> OLD.workflow_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
  RAISE EXCEPTION 'Problem text and origin are immutable; only the resolution may change';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_site_workflow_problems BEFORE UPDATE ON site_workflow_problems
 FOR EACH ROW EXECUTE FUNCTION site_workflow_problem_text_immutable();
CREATE TRIGGER no_delete_site_workflow_problems BEFORE DELETE ON site_workflow_problems
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Handover: actual cable used against the BOQ. Latest entry per cable line; every change is an event.
CREATE TABLE site_workflow_cables (
 workflow_id uuid NOT NULL REFERENCES site_workflow(id),
 item_key text NOT NULL,
 used_qty numeric(20,6) NOT NULL CHECK (used_qty >= 0),
 returned_qty numeric(20,6) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
 note text NOT NULL DEFAULT '',
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workflow_id, item_key)
);

-- Handover: items used outside the quotation. Withdraw-only, so Accounts sees the full trail.
CREATE TABLE site_workflow_additional_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workflow_id uuid NOT NULL REFERENCES site_workflow(id),
 description text NOT NULL CHECK (length(btrim(description)) > 0),
 quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
 unit text NOT NULL DEFAULT '',
 reason text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_by uuid REFERENCES users(id),
 withdrawn_at timestamptz,
 withdrawal_reason text NOT NULL DEFAULT ''
);
CREATE INDEX site_workflow_additional_items_workflow ON site_workflow_additional_items(workflow_id, created_at);
CREATE OR REPLACE FUNCTION site_workflow_additional_item_withdraw_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workflow_id <> OLD.workflow_id OR NEW.description <> OLD.description OR NEW.quantity <> OLD.quantity OR NEW.unit <> OLD.unit
  OR NEW.reason <> OLD.reason OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR OLD.withdrawn_at IS NOT NULL THEN
  RAISE EXCEPTION 'An additional item can only be withdrawn, not edited';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER withdraw_only_site_workflow_additional_items BEFORE UPDATE ON site_workflow_additional_items
 FOR EACH ROW EXECUTE FUNCTION site_workflow_additional_item_withdraw_only();
CREATE TRIGGER no_delete_site_workflow_additional_items BEFORE DELETE ON site_workflow_additional_items
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();

-- Back-fill: every existing Operations issuance gets a workflow row at IPO received,
-- or at Delivery when Store has already issued the material. Site type comes from the BOQ family.
INSERT INTO site_workflow (issuance_id, ipo_id, site_id, customer_id, stage, stage_entered_at, site_type, created_at)
SELECT o.id, o.ipo_id, b.site_id, b.customer_id,
 CASE WHEN s.id IS NOT NULL THEN 'delivery' ELSE 'ipo_received' END,
 COALESCE(s.created_at, o.created_at),
 CASE COALESCE(r.snapshot->'survey'->>'family', 'solar-hybrid')
  WHEN 'solar-hybrid' THEN 'Solar + BESS' WHEN 'bess-only' THEN 'BESS' ELSE NULL END,
 o.created_at
FROM operations_boq_issuances o
JOIN boq_revisions r ON r.id = o.boq_revision_id
JOIN boqs b ON b.id = r.boq_id
LEFT JOIN store_boq_issuances s ON s.issuance_id = o.id;
