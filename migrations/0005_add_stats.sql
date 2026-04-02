-- Cumulative counters that survive document expiry/deletion
CREATE TABLE stats (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- Initialize counters from existing data
INSERT INTO stats (key, value) SELECT 'documents_shared', COUNT(*) FROM documents WHERE id IN (SELECT DISTINCT document_id FROM links WHERE permission != 'admin');
INSERT INTO stats (key, value) SELECT 'comments_posted', COUNT(*) FROM comments;
INSERT INTO stats (key, value) VALUES ('collaborators', 0);
