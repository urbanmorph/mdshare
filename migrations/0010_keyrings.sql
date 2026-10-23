-- "Recent documents" sync: opt-in, end to end encrypted, no accounts.
--
-- A keyring is a device's recent-documents list (with its admin keys),
-- encrypted in the browser with a key derived from a random secret only the
-- user holds (it rides the fragment of their sync link, never the server). This
-- table stores the ciphertext only: the server can't read it or tell whose it is.
--   id          derived from the secret (HKDF), 32 hex chars; not the secret
--   write_hash  SHA-256 of the write key (also derived); gates update/delete
--   blob        base64url(iv || AES-GCM ciphertext), <= 256 KB
--   used_at     last read or write; rows unused for 12 months are deleted by
--               the daily cron (src/worker.ts)
CREATE TABLE IF NOT EXISTS keyrings (
  id          TEXT PRIMARY KEY,
  write_hash  TEXT NOT NULL,
  blob        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  used_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keyrings_used ON keyrings (used_at);
