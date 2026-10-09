-- Preserve M3 intentions and their existing budget/deadline.
ALTER TABLE invitation_delivery_intent ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invitation_delivery_intent ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invitation_delivery_intent ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invitation_delivery_intent ADD COLUMN publication_id TEXT;
ALTER TABLE invitation_delivery_intent ADD COLUMN accepted_at INTEGER;
ALTER TABLE invitation_delivery_intent ADD COLUMN last_outcome TEXT CHECK(last_outcome IN ('accepted','transient','permanent','unknown'));
CREATE TABLE email_delivery_attempt (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES invitation_delivery_intent(id),
 generation INTEGER NOT NULL,
 claimed_at INTEGER NOT NULL, lease_until INTEGER NOT NULL,
 started_at INTEGER, completed_at INTEGER,
 outcome TEXT CHECK(outcome IN ('accepted','transient','permanent','unknown')),
 UNIQUE(job_id,generation)
);
CREATE INDEX email_delivery_attempt_job ON email_delivery_attempt(job_id,generation);
CREATE INDEX email_delivery_attempt_expiry ON email_delivery_attempt(outcome,lease_until);
CREATE INDEX invitation_delivery_deadline ON invitation_delivery_intent(state,deadline);
