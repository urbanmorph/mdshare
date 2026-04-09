-- Track how each document entered mdshare (blank, paste, upload, mcp, vscode,
-- obsidian, api). Classified at POST /api/documents time from content type,
-- X-Source header, User-Agent, and Origin. Pre-existing rows keep 'unknown'.
ALTER TABLE documents ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';
