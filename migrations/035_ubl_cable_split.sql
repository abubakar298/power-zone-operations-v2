-- Append the user-confirmed equal split; preserve original and prior technical versions.
INSERT INTO ubl_technical_versions(configuration_id,version,snapshot,effective_date,notes)
SELECT configuration_id,3,
jsonb_set(jsonb_set(jsonb_set(snapshot,'{rows}',(
 SELECT jsonb_agg(piece ORDER BY ordinal,sub)
 FROM jsonb_array_elements(snapshot->'rows') WITH ORDINALITY AS x(row,ordinal)
 CROSS JOIN LATERAL (
 SELECT CASE WHEN row->>'id'='D11' THEN row || jsonb_build_object('id','D11R','description','DC Cable Red','quantity',((row->>'quantity')::numeric/2)::text,'unit','MTRS')
 WHEN row->>'id'='H29' THEN row || jsonb_build_object('deferred',false,'commercialTreatment','Included in combined offer; no separate invoice line') ELSE row END AS piece,1 AS sub
 UNION ALL SELECT row || jsonb_build_object('id','D11B','description','DC Cable Black','quantity',((row->>'quantity')::numeric/2)::text,'unit','MTRS'),2 WHERE row->>'id'='D11'
 ) parts
)),'{currentBoq}',(
 SELECT jsonb_agg(piece ORDER BY ordinal,sub)
 FROM jsonb_array_elements(snapshot->'rows') WITH ORDINALITY AS x(row,ordinal)
 CROSS JOIN LATERAL (
 SELECT CASE WHEN row->>'id'='D11' THEN row || jsonb_build_object('id','D11R','description','DC Cable Red','quantity',((row->>'quantity')::numeric/2)::text,'unit','MTRS')
 WHEN row->>'id'='H29' THEN row || jsonb_build_object('deferred',false,'commercialTreatment','Included in combined offer; no separate invoice line') ELSE row END AS piece,1 AS sub
 UNION ALL SELECT row || jsonb_build_object('id','D11B','description','DC Cable Black','quantity',((row->>'quantity')::numeric/2)::text,'unit','MTRS'),2 WHERE row->>'id'='D11'
 ) parts
)),'{currentTechnicalVersion}','3'::jsonb),NULL,
'User confirmed 50/50 red and black DC cable quantities. Internet remains in costing and the combined offer, with no separate invoice line. Existing purchasing-rate requirements remain.'
FROM ubl_technical_versions WHERE version=2;
