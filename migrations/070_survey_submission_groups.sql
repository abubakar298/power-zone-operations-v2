CREATE TABLE survey_submission_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Submitted')),
 package_id uuid REFERENCES ubl_survey_review_packages(id),
 created_at timestamptz NOT NULL DEFAULT now(),submitted_at timestamptz
);
CREATE UNIQUE INDEX one_open_survey_submission_group ON survey_submission_groups(created_by) WHERE status='Open';
CREATE TABLE survey_submission_group_members (
 record_id uuid PRIMARY KEY REFERENCES project_workflow_records(id),
 group_id uuid NOT NULL REFERENCES survey_submission_groups(id),
 saved_package_id uuid NOT NULL REFERENCES ubl_survey_review_packages(id),
 joined_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO survey_submission_groups(created_by)
SELECT DISTINCT p.created_by FROM project_workflow_records r
JOIN ubl_survey_review_packages p ON p.id=(r.data->>'ublSurveyPackageId')::uuid
WHERE r.stage='design_handed_off' AND r.data->>'ublSurveyPackageStatus'='Saved for combining';
INSERT INTO survey_submission_group_members(record_id,group_id,saved_package_id)
SELECT r.id,g.id,p.id FROM project_workflow_records r
JOIN ubl_survey_review_packages p ON p.id=(r.data->>'ublSurveyPackageId')::uuid
JOIN survey_submission_groups g ON g.created_by=p.created_by AND g.status='Open'
WHERE r.stage='design_handed_off' AND r.data->>'ublSurveyPackageStatus'='Saved for combining';
UPDATE project_workflow_records r SET data=r.data||jsonb_build_object('surveySubmissionGroupId',m.group_id)
FROM survey_submission_group_members m WHERE m.record_id=r.id;
