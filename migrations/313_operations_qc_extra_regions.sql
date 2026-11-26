-- Extra Operations regions for a QC account, so one QC user can cover Central and South.
-- The account's main region stays in operations_board_access.team; rows here add more regions.
-- Read only while the account is still QC. Existing accounts, records and permissions are unchanged.
CREATE TABLE operations_board_qc_regions (
 user_id uuid NOT NULL REFERENCES operations_board_access(user_id) ON DELETE CASCADE,
 team text NOT NULL CHECK(team IN ('central','south')),
 granted_by uuid NOT NULL REFERENCES users(id),
 granted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,team)
);
