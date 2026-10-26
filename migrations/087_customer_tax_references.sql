-- Additive storage only. Never seed or replace customer tax identities.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ntn text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS strn text NOT NULL DEFAULT '';
