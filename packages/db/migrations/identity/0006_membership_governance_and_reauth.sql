-- Migration 0006: Membership Governance and Reauth
-- Protects team workspace last owner invariant under concurrent D1 race via triggers.
-- Enforces personal workspace single-owner isolation.
-- Stores bounded 5-minute OAuth reauth intents tied to actor, account, workspace, action, and target.

CREATE TRIGGER trg_membership_team_last_owner_delete
BEFORE DELETE ON membership
WHEN OLD.role = 'owner' AND EXISTS (
  SELECT 1 FROM workspace w WHERE w.id = OLD.workspace_id AND w.type = 'team'
)
BEGIN
  SELECT CASE
    WHEN (
      SELECT COUNT(*) FROM membership
      WHERE workspace_id = OLD.workspace_id AND role = 'owner'
    ) <= 1
    THEN RAISE(ABORT, 'cannot remove last owner of a team workspace')
  END;
END;

CREATE TRIGGER trg_membership_team_last_owner_update
BEFORE UPDATE OF role ON membership
WHEN OLD.role = 'owner' AND NEW.role != 'owner' AND EXISTS (
  SELECT 1 FROM workspace w WHERE w.id = OLD.workspace_id AND w.type = 'team'
)
BEGIN
  SELECT CASE
    WHEN (
      SELECT COUNT(*) FROM membership
      WHERE workspace_id = OLD.workspace_id AND role = 'owner'
    ) <= 1
    THEN RAISE(ABORT, 'cannot demote last owner of a team workspace')
  END;
END;

CREATE TRIGGER trg_membership_personal_no_delete
BEFORE DELETE ON membership
WHEN EXISTS (
  SELECT 1 FROM workspace w WHERE w.id = OLD.workspace_id AND w.type = 'personal'
)
BEGIN
  SELECT RAISE(ABORT, 'cannot remove owner from personal workspace');
END;

CREATE TRIGGER trg_membership_personal_no_update
BEFORE UPDATE OF role ON membership
WHEN EXISTS (
  SELECT 1 FROM workspace w WHERE w.id = OLD.workspace_id AND w.type = 'personal'
)
BEGIN
  SELECT RAISE(ABORT, 'cannot change role in personal workspace');
END;

CREATE TABLE reauth_intent (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  original_session_id TEXT NOT NULL,
  proof_session_id TEXT,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('promote', 'demote', 'remove', 'leave')),
  target_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  consumed_at INTEGER
);

CREATE INDEX idx_reauth_intent_lookup ON reauth_intent(user_id, workspace_id, action, target_user_id, expires_at);
