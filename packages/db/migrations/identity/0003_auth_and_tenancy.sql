-- Migration 0003: Auth and Tenancy
-- Preserves storage_authority and github_code_redemption without modifying earlier migrations.

CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL CHECK (emailVerified IN (0, 1)),
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX idx_session_user ON session(userId);

CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(providerId, accountId)
);
CREATE INDEX idx_account_user ON account(userId);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE workspace (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) <= 128),
  type TEXT NOT NULL CHECK (type IN ('personal', 'team')),
  name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 128),
  personal_user_id TEXT UNIQUE REFERENCES user(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((type = 'personal' AND personal_user_id IS NOT NULL) OR (type = 'team' AND personal_user_id IS NULL))
);
CREATE INDEX idx_workspace_personal_user ON workspace(personal_user_id);

CREATE TABLE membership (
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_membership_user ON membership(user_id);

-- Enforce at the schema level that personal workspaces cannot have additional members on INSERT or UPDATE.
CREATE TRIGGER membership_personal_workspace_exclusive_insert
BEFORE INSERT ON membership
BEGIN
  SELECT CASE
    WHEN (SELECT type FROM workspace WHERE id = NEW.workspace_id) = 'personal'
     AND (SELECT personal_user_id FROM workspace WHERE id = NEW.workspace_id) != NEW.user_id
    THEN RAISE(ABORT, 'personal_workspace_exclusive')
  END;
END;

CREATE TRIGGER membership_personal_workspace_exclusive_update
BEFORE UPDATE ON membership
BEGIN
  SELECT CASE
    WHEN (SELECT type FROM workspace WHERE id = NEW.workspace_id) = 'personal'
     AND (SELECT personal_user_id FROM workspace WHERE id = NEW.workspace_id) != NEW.user_id
    THEN RAISE(ABORT, 'personal_workspace_exclusive')
  END;
END;

-- Personal workspace membership role must strictly be 'owner'; demoting or setting 'member' is rejected.
CREATE TRIGGER membership_personal_workspace_owner_only_insert
BEFORE INSERT ON membership
BEGIN
  SELECT CASE
    WHEN (SELECT type FROM workspace WHERE id = NEW.workspace_id) = 'personal'
     AND NEW.role != 'owner'
    THEN RAISE(ABORT, 'personal_workspace_owner_only')
  END;
END;

CREATE TRIGGER membership_personal_workspace_owner_only_update
BEFORE UPDATE ON membership
BEGIN
  SELECT CASE
    WHEN (SELECT type FROM workspace WHERE id = NEW.workspace_id) = 'personal'
     AND NEW.role != 'owner'
    THEN RAISE(ABORT, 'personal_workspace_owner_only')
  END;
END;

-- Workspace type and personal ownership are immutable on UPDATE to prevent silent conversion.
CREATE TRIGGER workspace_type_immutable_update
BEFORE UPDATE ON workspace
BEGIN
  SELECT CASE
    WHEN OLD.type != NEW.type
    THEN RAISE(ABORT, 'workspace_type_immutable')
    WHEN OLD.type = 'personal' AND (NEW.personal_user_id IS NULL OR NEW.personal_user_id != OLD.personal_user_id)
    THEN RAISE(ABORT, 'personal_workspace_owner_immutable')
  END;
END;

CREATE TABLE tenancy_operation (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(operation_id) <= 128),
  actor_user_id TEXT NOT NULL REFERENCES user(id),
  action TEXT NOT NULL CHECK (action = 'create_team'),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  target_workspace_id TEXT REFERENCES workspace(id),
  created_at INTEGER NOT NULL
);
