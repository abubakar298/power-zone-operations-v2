-- Additive C&I workflow: no changes to historical solar or master records.
CREATE TABLE cni_proposals (
 id uuid PRIMARY KEY, created_by uuid NOT NULL REFERENCES users(id),
 customer_id integer NOT NULL REFERENCES customers(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cni_proposal_versions (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL REFERENCES cni_proposals(id),
 version integer NOT NULL CHECK(version>0), number text UNIQUE NOT NULL,
 snapshot jsonb NOT NULL, internal_cost_snapshot jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(proposal_id,version)
);
CREATE TRIGGER immutable_cni_version BEFORE UPDATE OR DELETE ON cni_proposal_versions
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE cni_proposal_actions (
 id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES cni_proposal_versions(id),
 action text NOT NULL CHECK(action IN ('Approval requested','Approved','Revision requested')),
 remarks text NOT NULL DEFAULT '', instructions jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_cni_action BEFORE UPDATE OR DELETE ON cni_proposal_actions
 FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE INDEX cni_owner_idx ON cni_proposals(created_by);
CREATE INDEX cni_action_version_idx ON cni_proposal_actions(version_id,created_at);
