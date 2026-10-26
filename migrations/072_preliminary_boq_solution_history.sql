CREATE TABLE preliminary_boq_solution_history (
 id uuid PRIMARY KEY,reference text NOT NULL UNIQUE,workflow_id uuid NOT NULL REFERENCES project_workflow_records(id),
 draft_id uuid NOT NULL REFERENCES survey_drafts(id),draft_version integer NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 actor_name text NOT NULL,baseline jsonb NOT NULL,before_inputs jsonb NOT NULL,after_inputs jsonb NOT NULL,differences jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(draft_id,draft_version)
);
CREATE TRIGGER immutable_preliminary_solution_history BEFORE UPDATE OR DELETE ON preliminary_boq_solution_history FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
