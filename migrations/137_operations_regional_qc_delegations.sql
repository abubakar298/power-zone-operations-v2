-- Optional, revocable regional QC duty for an existing Operations lead.
-- Existing accounts, duties, records and permissions remain unchanged by migration.
CREATE TABLE operations_board_qc_delegations (
 user_id uuid PRIMARY KEY REFERENCES operations_board_access(user_id) ON DELETE CASCADE,
 team text NOT NULL CHECK(team IN ('central','south')),
 granted_by uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),
 granted_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,
 revoked_at timestamptz
);
