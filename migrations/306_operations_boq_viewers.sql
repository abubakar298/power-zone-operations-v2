-- View-only BOQ details on the Operations site page (owner request, 13 Nov 2026).
-- Granted per account; only Moaz's existing Operations account for now. Items and
-- quantities only: the route reads the price-free BOQ copy issued to Operations.
CREATE TABLE operations_boq_viewers (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  granted_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO operations_boq_viewers (user_id, granted_reason)
SELECT u.id, 'Owner-approved view-only BOQ details on Operations sites'
FROM users u
JOIN operations_board_access a ON a.user_id = u.id
WHERE u.email = 'moaz@powerzone.com.pk' AND u.active AND u.role = 'Operations'
ON CONFLICT (user_id) DO NOTHING;
