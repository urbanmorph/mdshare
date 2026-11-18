-- Replies are found by parent_id (resolving a thread resolves its replies), and a comment
-- author's first comment anywhere counts as a new collaborator (src/pages/api/d/[id]/comments.ts),
-- which looks the name up on every named comment. Both scanned the whole comments table.
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_author_name ON comments(author_name);
