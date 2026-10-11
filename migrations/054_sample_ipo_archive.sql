-- Owner identified these exact four IPOs as disposable samples on 12 October 2026.
-- Keep all source documents and handoff history; archive only their active queue entries.
CREATE TABLE archived_sample_ipos (
 ipo_id uuid PRIMARY KEY REFERENCES internal_purchase_orders(id),
 reason text NOT NULL,
 source_record jsonb NOT NULL,
 archived_at timestamptz NOT NULL DEFAULT now(),
 restored_at timestamptz
);
INSERT INTO archived_sample_ipos(ipo_id,reason,source_record)
SELECT id,'Abu Bakar requested removal of these four sample IPOs, 12 October 2026.',to_jsonb(i)
FROM internal_purchase_orders i
WHERE number IN ('CPZ-IPO-26-001-0001-001 (PZON-JIABAG)','IPO-000003','IPO-000002','IPO-000001');
