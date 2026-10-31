-- Owner-authorized IPO document handoff emails. No historical messages are queued.
CREATE TABLE ipo_document_email_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 mailbox_indexed_at timestamptz,
 activated_at timestamptz,
 updated_by uuid REFERENCES users(id)
);
INSERT INTO ipo_document_email_settings(singleton) VALUES(true);
CREATE TABLE ipo_mailbox_thread_index (
 gmail_thread_id text PRIMARY KEY,
 identity_key text NOT NULL,
 ipo text NOT NULL,
 order_number text NOT NULL,
 subject text NOT NULL,
 message_id text NOT NULL,
 reference_ids jsonb NOT NULL,
 routing_decision text NOT NULL DEFAULT 'unique_thread',
 review_notes jsonb NOT NULL DEFAULT '[]',
 indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ipo_mailbox_thread_identity ON ipo_mailbox_thread_index(identity_key);
CREATE INDEX ipo_mailbox_thread_ipo ON ipo_mailbox_thread_index(ipo);
CREATE TABLE ipo_document_email_threads (
 identity_key text PRIMARY KEY,
 subject text NOT NULL,
 root_message_id text,
 last_message_id text,
 reference_ids jsonb NOT NULL DEFAULT '[]',
 gmail_thread_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ipo_document_email_queue (
 id uuid PRIMARY KEY,
 source_key text UNIQUE NOT NULL,
 identity_key text NOT NULL,
 stage integer NOT NULL CHECK(stage BETWEEN 1 AND 6),
 context jsonb NOT NULL,
 evidence jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','sent','held','failed','superseded')),
 reason text,
 provider_id text,
 message_id text,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz
);
CREATE INDEX ipo_document_email_ready ON ipo_document_email_queue(next_attempt_at,created_at,id) WHERE state='queued';
CREATE INDEX ipo_document_email_reference ON ipo_document_email_queue(sent_at,id) WHERE state='sent' AND message_id IS NULL;
CREATE INDEX ipo_document_email_identity ON ipo_document_email_queue(identity_key,created_at,id);
-- Each provider acceptance is saved separately, including multipart deliveries.
CREATE TABLE ipo_document_email_parts (
 queue_id uuid NOT NULL REFERENCES ipo_document_email_queue(id),
 part integer NOT NULL,
 evidence jsonb NOT NULL,
 provider_id text,
 message_id text,
 sent_at timestamptz,
 PRIMARY KEY(queue_id,part)
);
