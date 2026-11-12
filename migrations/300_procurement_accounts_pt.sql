-- Extend the existing immutable PT register for approved supplier purchases.
ALTER TABLE accounts_pt_entries DROP CONSTRAINT accounts_pt_entries_source_kind_check;
ALTER TABLE accounts_pt_entries ADD CONSTRAINT accounts_pt_entries_source_kind_check
  CHECK (source_kind IN ('IPO', 'Inventory', 'Procurement'));
