-- Staff profile preparation only. No accounts, permissions or real recipients are seeded.
CREATE TABLE staff_profile_intents (
 id uuid PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 token_id uuid UNIQUE REFERENCES account_tokens(id),
 issued_token_reference uuid NOT NULL,
 CHECK(token_id IS NULL OR token_id=issued_token_reference),
 subject_user_id uuid REFERENCES users(id), email text NOT NULL CHECK(email=lower(email)),
 expected_fingerprint text NOT NULL CHECK(expected_fingerprint ~ '^[a-f0-9]{64}$'),
 profile jsonb NOT NULL CHECK(jsonb_typeof(profile)='object' AND profile->>'role' IN('Operations','Inventory')),
 before_snapshot jsonb NOT NULL CHECK(jsonb_typeof(before_snapshot)='object'),
 reason text NOT NULL CHECK(length(btrim(reason))>=3),
 request_key uuid NOT NULL UNIQUE,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve the nonsecret issuance identity even when disaster recovery discards
-- active authentication links. A restored intent cannot consume another token.
CREATE FUNCTION staff_profile_token_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.issued_token_reference IS NULL THEN NEW.issued_token_reference := NEW.token_id; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER staff_profile_token_reference BEFORE INSERT ON staff_profile_intents FOR EACH ROW EXECUTE FUNCTION staff_profile_token_reference();
CREATE INDEX staff_profile_email_latest ON staff_profile_intents(email,sequence DESC);
CREATE TRIGGER immutable_staff_profile_intent BEFORE UPDATE OR DELETE ON staff_profile_intents FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
CREATE TABLE staff_profile_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intent_id uuid NOT NULL UNIQUE REFERENCES staff_profile_intents(id),
 user_id uuid NOT NULL REFERENCES users(id), approved_by uuid NOT NULL REFERENCES users(id),
 before_snapshot jsonb NOT NULL, after_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_staff_profile_application BEFORE UPDATE OR DELETE ON staff_profile_applications FOR EACH ROW EXECUTE FUNCTION prevent_master_version_mutation();
