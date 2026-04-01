-- Documents
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Access links
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('admin', 'view', 'edit', 'comment')),
  label TEXT,
  is_active INTEGER DEFAULT 1,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_links_token_prefix ON links(token_prefix);
CREATE INDEX idx_links_document_id ON links(document_id);

-- Comments
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT 'Anonymous',
  content TEXT NOT NULL,
  anchor_text TEXT,
  anchor_start INTEGER,
  anchor_end INTEGER,
  resolved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_document_id ON comments(document_id);

-- Version history
CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  edited_via TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_versions_document_id ON versions(document_id);
