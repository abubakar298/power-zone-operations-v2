-- Supply the missing line-to-site link on the two imported single-site DOs.
-- Keep the original dispatch snapshots, signed evidence and movements intact.
CREATE OR REPLACE VIEW inventory_material_dispatches_active AS
SELECT d.id,d.number,d.draft_id,d.draft_version,d.source_sha256,d.warehouse,
  CASE WHEN d.number IN ('CPZ-DO-815','CPZ-DO-816')
    AND d.warehouse='Lahore warehouse'
    AND d.snapshot->>'historical'='true'
    AND d.snapshot->>'siteId'='registered-UBL:SOLAR:349'
  THEN jsonb_set(d.snapshot,'{lines}',(
    SELECT jsonb_agg(
      CASE WHEN jsonb_typeof(l.line->'sites') IS NOT DISTINCT FROM 'array'
        THEN l.line
        ELSE l.line || jsonb_build_object('sites',jsonb_build_array(d.snapshot->>'siteId'))
      END ORDER BY l.ordinal
    )
    FROM jsonb_array_elements(d.snapshot->'lines') WITH ORDINALITY l(line,ordinal)
  ))
  ELSE d.snapshot END AS snapshot,
  d.request_key,d.request_fingerprint,d.created_by,d.created_at
FROM inventory_material_dispatches d
WHERE coalesce(d.snapshot->>'cancelled','false')<>'true';
