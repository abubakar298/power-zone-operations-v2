-- Preserve a genuinely new Accounts receipt for an older IPO. Suppress the older
-- generic receipt only when the new IPO-created handoff already covers that IPO.
CREATE OR REPLACE VIEW notification_events AS
 SELECT * FROM before_workflow_handoff_events e WHERE NOT(
 e.source_key LIKE 'accounts:%' AND EXISTS(
  SELECT 1 FROM workflow_handoff_policy_current p JOIN internal_purchase_orders i ON i.id::text=e.target->>'ipo_id'
  WHERE p.enabled AND e.created_at>=p.activated_at AND i.created_at>=p.activated_at
 ))
 UNION ALL SELECT * FROM workflow_handoff_events;
