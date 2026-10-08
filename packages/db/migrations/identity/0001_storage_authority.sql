-- Owner: packages/db/identity. No auth, tenancy or review tables are implied.
CREATE TABLE storage_authority (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  authority TEXT NOT NULL CHECK (authority = 'identity')
);
INSERT INTO storage_authority (singleton, authority) VALUES (1, 'identity');
