-- Migration 0004: Durable Rate Limiting
-- Additive rate limit store for atomic token consumption in D1.

CREATE TABLE rate_limit (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
CREATE INDEX idx_rate_limit_window ON rate_limit(window_start);
