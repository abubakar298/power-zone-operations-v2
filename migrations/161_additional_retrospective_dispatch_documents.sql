-- Owner confirmation, 1 November 2026: these ten exact DO records were prepared
-- after the teams left. No gate copies exist. Documentary/custody eligibility
-- only: preserve every DO and pending-stock record; never post or replay stock OUT.
-- Preserve the original six customer-DO exceptions; today's authority waives gate copies only.
ALTER TABLE inventory_retrospective_dispatches ADD COLUMN customer_do_waived boolean NOT NULL DEFAULT true;
INSERT INTO inventory_retrospective_dispatches(dispatch_id,dispatch_number,warehouse,reason,authority,customer_do_waived)
 SELECT d.id,d.number,d.warehouse,
 'Owner confirmed already dispatched before paperwork. Gate copy unavailable; Inventory uses the applicable signed DO/VSO evidence, with acknowledgment retained separately by QC/Accounts. This exception does not post stock.',
 'Owner confirmation in Inventory workflow chat, 1 November 2026: ten newer individual DOs',false
 FROM inventory_material_dispatches_active d
 JOIN (VALUES
 ('871a33c6-b09a-4828-9bac-5ec25e0e36ed'::uuid,'CPZ-DO-26-0007','Multan warehouse'),
 ('0b885f25-bdba-4593-8839-ad1df2c84928'::uuid,'CPZ-DO-26-0008','Multan warehouse'),
 ('f7bd320c-95e8-477d-b7db-ee3d129bfae6'::uuid,'CPZ-DO-26-0009','Islamabad warehouse'),
 ('c1269c93-3eb1-41d8-b424-e01ec6fb6135'::uuid,'CPZ-DO-26-0010','Islamabad warehouse'),
 ('b651c3af-6b27-4c85-a67c-7986a0501c7a'::uuid,'CPZ-DO-26-0011','Islamabad warehouse'),
 ('769a9daf-209e-43f1-a42c-323333bd038e'::uuid,'CPZ-DO-26-0013','Jia Bagga warehouse'),
 ('43bb4f1e-ab30-4621-977b-0f47146d0ecf'::uuid,'CPZ-DO-26-0014','Islamabad warehouse'),
 ('3a15a5b9-46e5-4907-958a-bda4460d3c04'::uuid,'CPZ-DO-26-0015','Lahore warehouse'),
 ('6aa13d53-60cc-48fc-a46e-c045b58789cb'::uuid,'CPZ-DO-26-0016','Lahore warehouse'),
 ('b2d034be-221a-4e5e-a40e-7a45bf4a83d6'::uuid,'CPZ-DO-26-0017','Lahore warehouse')
 ) approved(id,number,warehouse) ON approved.id=d.id AND approved.number=d.number AND approved.warehouse=d.warehouse
 WHERE d.created_at >= '2026-11-01T00:00:00Z' AND d.created_at < '2026-11-02T00:00:00Z'
 ON CONFLICT(dispatch_id) DO NOTHING;
