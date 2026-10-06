-- Qualified D1 primitive from M0. No raw OAuth credential is retained.
CREATE TABLE github_code_redemption (
  fingerprint TEXT PRIMARY KEY NOT NULL CHECK (length(fingerprint) = 64),
  expires_at INTEGER NOT NULL
);
CREATE INDEX github_code_redemption_expiry ON github_code_redemption(expires_at, fingerprint);
