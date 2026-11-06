-- Final UBL extra form follows Multan Surveys workbook columns E:V only.
-- Customer/site identification is already displayed in the request summary.
-- Prior form versions remain immutable for document history.
INSERT INTO customer_survey_form_templates(key,version,customer_code,payload,source_reference)
SELECT key,2,customer_code,
 jsonb_set(jsonb_set(payload,'{fields}',(
  SELECT jsonb_agg(jsonb_set(field,'{group}','"UBL survey details"'::jsonb) ORDER BY ordering.ordinality)
  FROM jsonb_array_elements(payload->'fields') field
  JOIN unnest(ARRAY['gensetKva','loadShedding','roofSpace','phase','runningLoad','connectedLoad','wapda','atm','acQty','internalWiring','roofType','property','mainDb','obstacles','itSpace','wifi','recommendation','clientRemarks']) WITH ORDINALITY ordering(key,ordinality)
   ON field->>'key'=ordering.key
 )), '{sources}', '[{"file":"Multan Surveys.xlsx","sheet":"11 Sites (Punjab) (2)","range":"E7:V7"}]'::jsonb),
 'Final extra-entry fields from Multan Surveys.xlsx, sheet 11 Sites (Punjab) (2), E7:V7; identity and vendor omitted by Abu Bakar, 13 October 2026'
FROM customer_survey_form_templates WHERE key='ubl-solar-survey' AND version=1;
