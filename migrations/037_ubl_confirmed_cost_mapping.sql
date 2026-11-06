-- User-confirmed current costing; preserve all earlier technical/budget versions.
WITH revised AS (
SELECT configuration_id,snapshot,jsonb_agg(
 CASE WHEN row->>'id'='D9' THEN row || jsonb_build_object('id','BOX','description','AC & DC Boxes','specification','Combined enclosure allowance covering rooftop, inverter-room and AC combiner boxes','quantity','2','unit','No.','bundle',NULL,'proposalSellingRate',NULL,'proposalTax',NULL,'proposalSellingTotal',NULL)
 WHEN row->>'id'='D12' THEN row || jsonb_build_object('id','MISC','description','Misc. Accessories','specification','Combined AC/DC glands, lugs, ferrules, termination kits, conduits and MC4 connectors','quantity','1','unit','LS','bundle',NULL,'proposalSellingRate',NULL,'proposalTax',NULL,'proposalSellingTotal',NULL)
 WHEN row->>'id'='C3' AND snapshot->>'inverterKw'='30' THEN row || jsonb_build_object('quantity','2','specification','2 × 15 kW three-phase hybrid inverters; combined 30 kW')
 WHEN row->>'id'='H29' THEN row || jsonb_build_object('specification','Router/device plus one month internet package; additional 11 months billed separately outside this offer','quantity','1','unit','JOB')
 ELSE row END ORDER BY ordinal) AS rows
FROM ubl_technical_versions, jsonb_array_elements(snapshot->'rows') WITH ORDINALITY AS x(row,ordinal)
WHERE version=3 AND row->>'id' NOT IN ('D10','D13','D14','D15','E21','E22','E23')
GROUP BY configuration_id,snapshot
)
INSERT INTO ubl_technical_versions(configuration_id,version,snapshot,effective_date,notes)
SELECT configuration_id,4,jsonb_set(jsonb_set(jsonb_set(snapshot,'{rows}',rows),'{currentBoq}',rows),'{currentTechnicalVersion}','4'),NULL,
'Owner-confirmed mappings: existing two AC/DC box allowance; one combined miscellaneous accessories allowance; no unused 35mm² battery cable; 30 kW = two 15 kW inverters. Router and first month cost PKR 3,000; no separate invoice line in this offer.' FROM revised;
INSERT INTO rate_versions(key,version,rate,status,notes)
SELECT 'UBL Internet',COALESCE(max(version),0)+1,3000,'Active','Owner confirmed device plus one month, 10 October 2026. Additional 11 months are a separate future invoice discussion.' FROM rate_versions WHERE key='UBL Internet';
