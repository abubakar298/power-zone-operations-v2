-- Apply approved standard amounts as new master versions; frozen documents remain intact.
WITH profile AS (
 SELECT payload FROM engineering_profiles_current WHERE key='standard-installation'
), approved AS (
 SELECT 'AC & DC Boxes' AS key,(payload->>'siteBoxesCost')::numeric AS rate FROM profile
 UNION ALL SELECT 'Misc. Accessories',(payload->>'miscCost')::numeric FROM profile
 UNION ALL SELECT 'Earthing Bore',(payload->>'standardBoreCost')::numeric FROM profile
)
INSERT INTO rate_versions(key,version,rate,status,notes)
SELECT a.key,COALESCE((SELECT max(version) FROM rate_versions WHERE key=a.key),0)+1,a.rate,'Active',
 'Final approved standard cost synchronized from engineering database; owner confirmed 13 October 2026. Historical snapshots and UBL bore exception retained.'
FROM approved a WHERE a.rate IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM rate_versions r WHERE r.key=a.key AND r.version=(SELECT max(version) FROM rate_versions WHERE key=a.key) AND r.rate=a.rate
);
