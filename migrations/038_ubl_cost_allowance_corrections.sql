-- UBL-only owner corrections. Preserve earlier budgets and general project rates.
WITH revised AS (
SELECT configuration_id,snapshot,jsonb_agg(CASE WHEN row->>'id'='BOX' THEN row || jsonb_build_object('quantity','1','unit','LS','specification','One combined AC/DC box allowance, covering both boxes') WHEN row->>'id'='G27' THEN row || jsonb_build_object('includedIn','C3','specification','Smart meter supplied with inverter; included in inverter price, no separate charge') ELSE row END ORDER BY ordinal) AS rows
FROM ubl_technical_versions,jsonb_array_elements(snapshot->'rows') WITH ORDINALITY AS x(row,ordinal)
WHERE version=4 GROUP BY configuration_id,snapshot
)
INSERT INTO ubl_technical_versions(configuration_id,version,snapshot,effective_date,notes)
SELECT configuration_id,5,jsonb_set(jsonb_set(jsonb_set(snapshot,'{rows}',rows),'{currentBoq}',rows),'{currentTechnicalVersion}','5'),NULL,
'Owner corrections: one combined AC/DC box allowance; smart meter included with inverter, no separate cost; UBL genset synchronization cost 10,000; earthing bores 30,000 each, two required. Earlier technical and budget versions retained.' FROM revised;
INSERT INTO item_master(key,unit,display_name,item_group) VALUES
('UBL Earthing Bore','No.','UBL Earthing Bore','UBL reference costing'),('UBL Genset Synchronisation','JOB','UBL Genset Synchronisation','UBL reference costing') ON CONFLICT(key) DO NOTHING;
INSERT INTO rate_versions(key,version,rate,status,notes) SELECT 'UBL Earthing Bore',COALESCE(max(version),0)+1,30000,'Active','Owner confirmed UBL-only cost per bore, 10 October 2026' FROM rate_versions WHERE key='UBL Earthing Bore';
INSERT INTO rate_versions(key,version,rate,status,notes) SELECT 'UBL Genset Synchronisation',COALESCE(max(version),0)+1,10000,'Active','Owner confirmed UBL-only synchronization cost, 10 October 2026' FROM rate_versions WHERE key='UBL Genset Synchronisation';
