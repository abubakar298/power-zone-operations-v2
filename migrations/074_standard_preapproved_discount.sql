-- New immutable policy version; existing financial/document snapshots stay unchanged.
INSERT INTO standard_commercial_policy_versions(version,policy)
SELECT version+1,policy || '{"costUpliftPercent":"5","preapprovedCostDiscountPercent":"5"}'::jsonb
FROM standard_commercial_policy_versions ORDER BY version DESC LIMIT 1;
