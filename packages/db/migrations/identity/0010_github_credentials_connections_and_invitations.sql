-- Native OAuth writes and coordinated refresh share one causal generation.
CREATE TABLE github_credential_state (
 account_id TEXT PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL CHECK(state IN ('ready','refreshing','reconnect_required')),
 claim_id TEXT, claim_until INTEGER
);
INSERT INTO github_credential_state(account_id,state) SELECT id,'ready' FROM account WHERE providerId='github';
CREATE TRIGGER github_credential_insert AFTER INSERT ON account WHEN NEW.providerId='github'
BEGIN INSERT INTO github_credential_state(account_id,state) VALUES(NEW.id,'ready'); END;
CREATE TRIGGER github_credential_write AFTER UPDATE OF accessToken,refreshToken ON account WHEN NEW.providerId='github'
BEGIN UPDATE github_credential_state SET generation=generation+1,state='ready',claim_id=NULL,claim_until=NULL WHERE account_id=NEW.id; END;
CREATE TABLE github_connection (
 installation_id INTEGER PRIMARY KEY CHECK(installation_id>0),
 workspace_id TEXT NOT NULL REFERENCES workspace(id),
 account_owner_id INTEGER NOT NULL CHECK(account_owner_id>0),
 state TEXT NOT NULL CHECK(state IN ('active','suspended','revoked')),
 generation INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES user(id), updated_at INTEGER NOT NULL
);
CREATE INDEX github_connection_workspace ON github_connection(workspace_id,state);
CREATE TABLE github_grant_cache (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
 credential_generation INTEGER NOT NULL,
 installation_id INTEGER NOT NULL REFERENCES github_connection(installation_id) ON DELETE CASCADE,
 connection_generation INTEGER NOT NULL,
 repository_ids TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,account_id,installation_id)
);
CREATE TRIGGER github_credential_invalidate AFTER UPDATE ON github_credential_state
BEGIN DELETE FROM github_grant_cache WHERE account_id=NEW.account_id; END;
CREATE TRIGGER github_connection_invalidate AFTER UPDATE ON github_connection
BEGIN DELETE FROM github_grant_cache WHERE installation_id=NEW.installation_id; END;
CREATE TABLE collaboration_guard(attempt_id TEXT PRIMARY KEY, admitted INTEGER NOT NULL CHECK(admitted IN (0,1)));
CREATE TABLE workspace_invitation (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspace(id),
 created_by TEXT NOT NULL REFERENCES user(id), operation_id TEXT NOT NULL,
 email TEXT NOT NULL, locale TEXT NOT NULL CHECK(locale IN ('en','pt-BR')),
 state TEXT NOT NULL CHECK(state IN ('pending','accepted','canceled','expired')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 accepted_by TEXT REFERENCES user(id), terminal_at INTEGER,
 UNIQUE(created_by,operation_id)
);
CREATE INDEX workspace_invitation_list ON workspace_invitation(workspace_id,state,created_at);
CREATE INDEX workspace_invitation_expiry ON workspace_invitation(state,expires_at);
CREATE TABLE invitation_delivery_intent (
 id TEXT PRIMARY KEY REFERENCES workspace_invitation(id),
 state TEXT NOT NULL CHECK(state IN ('pending','canceled','completed','failed')),
 next_action_at INTEGER NOT NULL, deadline INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts>0)
);
CREATE INDEX invitation_delivery_due ON invitation_delivery_intent(state,next_action_at);
CREATE TRIGGER invitation_delivery_terminal AFTER UPDATE OF state ON workspace_invitation WHEN NEW.state!='pending'
BEGIN UPDATE invitation_delivery_intent SET state='canceled' WHERE id=NEW.id AND state='pending'; END;
CREATE TABLE invitation_budget(scope TEXT PRIMARY KEY, window_start INTEGER NOT NULL, used INTEGER NOT NULL);

CREATE TABLE github_access_event_receipt(delivery_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,created_at INTEGER NOT NULL);
