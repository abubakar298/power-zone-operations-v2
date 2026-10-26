-- Owner-approved wording; append a specification version, preserving history.
INSERT INTO item_spec_versions(key,version,specification,status,notes)
SELECT 'CH-BMS-HV', COALESCE(MAX(version),0)+1,
'IP65 Battery Control and Safety Unit for High Voltage Batteries', 'Approved',
'Owner-approved BMS wording, 6 October 2026'
FROM item_spec_versions WHERE key='CH-BMS-HV';
CREATE TABLE quotation_description_defaults(key text PRIMARY KEY,description text NOT NULL);
INSERT INTO quotation_description_defaults(key,description)
VALUES('bms','IP65 Battery Control and Safety Unit for High Voltage Batteries');
