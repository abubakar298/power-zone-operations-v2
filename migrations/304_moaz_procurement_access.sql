-- Owner-approved Procurement buyer access for Moaz's existing Operations account.
INSERT INTO procurement_access (user_id, capability, granted_reason)
SELECT u.id, 'buyer', 'Owner-approved Operations and Procurement workspace access'
FROM users u
JOIN operations_board_access a ON a.user_id = u.id
WHERE u.email = 'moaz@powerzone.com.pk' AND u.active AND u.role = 'Operations'
ON CONFLICT (user_id, capability) DO NOTHING;
