-- Owner-requested email/password setup for existing unverified staff accounts.
-- No password or verification state changes until the one-use emailed link is consumed.
ALTER TABLE account_tokens DROP CONSTRAINT account_tokens_purpose_check;
ALTER TABLE account_tokens ADD CONSTRAINT account_tokens_purpose_check
 CHECK (purpose IN ('invite','reset','verify','setup'));
ALTER TABLE account_tokens DROP CONSTRAINT account_tokens_check;
ALTER TABLE account_tokens ADD CONSTRAINT account_tokens_identity_check CHECK (
 (purpose='invite' AND role IS NOT NULL AND user_id IS NULL) OR
 (purpose IN ('reset','verify','setup') AND user_id IS NOT NULL AND role IS NULL)
);
ALTER TABLE account_tokens ADD CONSTRAINT account_tokens_setup_authorised_check
 CHECK (purpose<>'setup' OR created_by IS NOT NULL);
