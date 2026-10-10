-- Owner-authorized provisional purchasing rate; no UBL budget/history changes.
INSERT INTO item_master(key,unit,display_name,item_group) VALUES('63A 4P Changeover','No.','63A 4P Changeover','AC switchgear') ON CONFLICT(key) DO NOTHING;
INSERT INTO rate_versions(key,version,rate,status,notes) SELECT '63A 4P Changeover',1,7500,'Under review','Owner provisional cost, 10 October 2026. Verify supplier price and final equipment specification before marking Active.' WHERE NOT EXISTS(SELECT 1 FROM rate_versions WHERE key='63A 4P Changeover');
