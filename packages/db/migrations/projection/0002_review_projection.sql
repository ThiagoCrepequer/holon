CREATE TABLE review_projection_scope (
  installation_id INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  state TEXT NOT NULL CHECK(state IN ('active','rebuilding')),
  PRIMARY KEY (installation_id, repository_id)
);
CREATE TABLE review_projection (
  installation_id INTEGER NOT NULL, repository_id INTEGER NOT NULL,
  pull_request_number INTEGER NOT NULL, generation INTEGER NOT NULL,
  snapshot_revision INTEGER NOT NULL CHECK(snapshot_revision > 0),
  activity_at TEXT NOT NULL, state TEXT NOT NULL,
  normalized_title TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (installation_id, repository_id, pull_request_number)
);
CREATE INDEX review_projection_activity ON review_projection
  (installation_id, repository_id, generation, activity_at DESC, pull_request_number DESC);
CREATE INDEX review_projection_state_activity ON review_projection
  (installation_id, repository_id, generation, state, activity_at DESC, pull_request_number DESC);
