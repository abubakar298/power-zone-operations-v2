-- Owner explicitly authorized Accounts to view BESS costs on 29 October 2026.
-- Keep the existing named-person capability and other departments unchanged.
WITH owner AS (
 SELECT id FROM users WHERE active AND role='Admin'
 AND regexp_replace(lower(display_name),'[^a-z]','','g') IN('abubakar','abubakarsiddique')
 ORDER BY id LIMIT 1
), granted AS (
 INSERT INTO restricted_cost_access(user_id,granted_reason)
 SELECT u.id,'Owner authorized Accounts BESS cost visibility, 29-Oct-2026'
 FROM users u CROSS JOIN owner WHERE u.active AND u.role='Accounts'
 ON CONFLICT(user_id) DO NOTHING RETURNING user_id
)
INSERT INTO audit_log(user_id,action)
SELECT owner.id,'accounts.bess-cost-access.granted:'||granted.user_id::text||':owner-authorized-20261029'
FROM granted CROSS JOIN owner;
