-- Preserve outstanding proofs while extending their accepted actions.
CREATE TABLE reauth_intent_extended (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  original_session_id TEXT NOT NULL,
  proof_session_id TEXT,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('promote', 'demote', 'remove', 'leave', 'link', 'unlink')),
  target_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  consumed_at INTEGER
);

INSERT INTO reauth_intent_extended SELECT * FROM reauth_intent;
DROP TABLE reauth_intent;
ALTER TABLE reauth_intent_extended RENAME TO reauth_intent;
CREATE INDEX idx_reauth_intent_lookup ON reauth_intent(user_id,workspace_id,action,target_user_id,expires_at);
CREATE INDEX idx_reauth_intent_expiry ON reauth_intent(expires_at,id);
