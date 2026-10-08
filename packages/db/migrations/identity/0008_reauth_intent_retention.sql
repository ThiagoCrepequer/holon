-- Bounded cleanup scans expiry directly without visiting the entire identity table.
CREATE INDEX idx_reauth_intent_expiry ON reauth_intent(expires_at, id);
