-- Migration 0005: Tenancy Mutation Guard
-- Transient transaction marker for exact atomic admission and expiry check within D1 batch.

CREATE TABLE tenancy_mutation_guard (
  attempt_key TEXT PRIMARY KEY NOT NULL,
  admitted INTEGER NOT NULL CHECK (admitted IN (0, 1))
);
