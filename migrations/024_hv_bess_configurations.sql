-- Owner-confirmed 7 October 2026. Historical snapshots and rate versions remain immutable.
INSERT INTO inverter_configurations(configuration,total_kw,sku,quantity)
VALUES ('2×12 kW',24,'HYB-3P-012',2);
-- Supplied landed rates exclude GST. Append only if the current rate differs.
INSERT INTO rate_versions(key,version,rate,status,notes)
SELECT x.key, old.version+1,x.rate,'Active','Owner-confirmed landed cost excluding GST, 7 October 2026'
FROM (VALUES ('HYB-3P-010',317884),('HYB-3P-012',363076),('HYB-3P-015',380014),
('HYB-3P-020',412144),('BAT-HV-05 KW WO BMS',231962),('CH-BMS-HV',158996)) x(key,rate)
JOIN LATERAL (SELECT version,rate,status FROM rate_versions WHERE key=x.key ORDER BY version DESC LIMIT 1) old ON true
WHERE old.rate IS DISTINCT FROM x.rate OR old.status <> 'Active';
