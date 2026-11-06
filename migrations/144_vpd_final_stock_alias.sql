-- Identity-only repair: the recorded VPD catalogue describes the same 2-pole
-- device as the reviewed final stock master. Preserve commercial wording/rates,
-- historical DO snapshots, quantities and all stock movements/balances.
INSERT INTO inventory_final_stock_aliases(old_id,item_id) VALUES
 ('CH-VPD-2P','CH-VPD-63A/2P'),
 ('63A 1P AC VPD','CH-VPD-63A/2P')
ON CONFLICT (old_id,item_id) DO NOTHING;

-- Retain the existing VPD commercial description and rate link in the final-ID
-- read projection; neither recorded catalogue nor historical masters are rewritten.
CREATE OR REPLACE VIEW inventory_catalogue_final_current AS
 SELECT c.item_id,c.version,
   c.payload || jsonb_build_object('finalStockId',f.item_id IS NOT NULL,
     'stockUnits',coalesce(f.units,'[]'::jsonb),'stockDescription',f.description,
     'stockIdentityStatus',CASE WHEN f.item_id IS NOT NULL THEN 'Final Sheet ID' ELSE 'Commercial / service reference; stock link pending' END) AS payload,
   c.rate_key,c.created_at
 FROM inventory_catalogue_recorded c
 LEFT JOIN inventory_final_stock_ids f ON f.item_id=c.item_id
 WHERE NOT EXISTS(SELECT 1 FROM inventory_final_stock_aliases a WHERE a.old_id=c.item_id AND a.item_id<>c.item_id)
 UNION ALL
 SELECT f.item_id,coalesce(c.version,1),
   coalesce(c.payload,jsonb_build_object(
      'technicalDescription',f.description,'commercialDescription',f.description,
      'category',f.category,'itemGroup',CASE
       WHEN f.category IN ('AC cables','DC cables','Earthing cables','Communication cables') THEN 'Cables'
       WHEN f.category='Solar panels' THEN 'Solar Panels'
       WHEN f.category='AC switchgear' THEN 'AC Switchgear'
       WHEN f.category='DC switchgear' THEN 'DC Switchgear'
       WHEN f.category='DB boxes' THEN 'AC / DC Boxes' ELSE f.category END,
      'brandCategory',CASE WHEN f.item_id LIKE '%/PK' OR f.item_id LIKE '%-PK' THEN 'Pakistan Cables'
       WHEN f.item_id LIKE '%/NA' OR f.item_id LIKE '%-NA' THEN 'Newage Cables'
       WHEN f.item_id LIKE '%/LCL' THEN 'All other cables' ELSE 'Unconfirmed' END,
      'unit',f.units->>0,'itemType','Stock','status','Needs review',
      'reviewNotes','Final Sheet ID approved. Commercial/rate link pending; no rate or stock balance imported.'))
    || jsonb_build_object('itemId',f.item_id,'finalStockId',true,
       'stockUnits',f.units,'stockDescription',f.description,
       'legacyItemId',coalesce(f.source_live_id,c.item_id),'rateLinkPending',c.item_id IS NULL,
       'stockIdentityStatus','Final Sheet ID') AS payload,
   c.rate_key,coalesce(c.created_at,f.approved_at)
 FROM inventory_final_stock_ids f
 LEFT JOIN inventory_catalogue_recorded c ON c.item_id=coalesce(f.source_live_id,CASE WHEN f.item_id='CH-VPD-63A/2P' THEN 'CH-VPD-2P' END)
 WHERE NOT EXISTS(SELECT 1 FROM inventory_catalogue_recorded direct WHERE direct.item_id=f.item_id);
