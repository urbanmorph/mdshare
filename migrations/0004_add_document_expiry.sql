-- Documents auto-expire after 90 days by default
ALTER TABLE documents ADD COLUMN expires_at TEXT;
