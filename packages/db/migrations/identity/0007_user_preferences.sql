-- Personal presentation preferences; existing identity/memberships remain intact.
CREATE TABLE user_preference (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'pt-BR')),
  timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 100),
  updated_at INTEGER NOT NULL
);
