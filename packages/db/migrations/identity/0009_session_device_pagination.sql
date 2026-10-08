-- Stable keyset traversal avoids sorting every active device for each page.
CREATE INDEX idx_session_device_page ON session(userId, createdAt DESC, id DESC);
