ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles ADD CONSTRAINT roles_name_check CHECK(name IN('Admin','Management','Employee','Coordinator','Operations','Inventory','Accounts','Design'));
INSERT INTO roles(name) VALUES('Design');
CREATE TABLE design_surveys (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 inputs jsonb NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE design_survey_handoffs (
 id uuid PRIMARY KEY, survey_id uuid UNIQUE NOT NULL REFERENCES design_surveys(id),
 form_version integer NOT NULL, draft_id uuid UNIQUE NOT NULL REFERENCES survey_drafts(id),
 assigned_to uuid NOT NULL REFERENCES users(id), created_by uuid NOT NULL REFERENCES users(id),
 inputs jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX design_survey_owner ON design_surveys(owner_id,updated_at DESC);
CREATE TRIGGER immutable_design_survey_handoff BEFORE UPDATE OR DELETE ON design_survey_handoffs FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE FUNCTION protect_sent_design_survey() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM design_survey_handoffs WHERE survey_id=OLD.id) THEN RAISE EXCEPTION 'Sent design survey is immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER protect_sent_design_survey BEFORE UPDATE OR DELETE ON design_surveys FOR EACH ROW EXECUTE FUNCTION protect_sent_design_survey();
