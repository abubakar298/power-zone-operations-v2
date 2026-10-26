CREATE TABLE survey_team_members (
 id uuid PRIMARY KEY,
 member_number integer GENERATED ALWAYS AS IDENTITY UNIQUE,
 display_name text NOT NULL CHECK(length(display_name)>0),
 phone text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX survey_team_member_identity ON survey_team_members(lower(display_name),phone);
