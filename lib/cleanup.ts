// The daily cron's delete of expired documents (src/worker.ts), here so it can be tested
// on real SQLite. expires_at holds JavaScript's ISO string ("2026-10-25T01:31:10.123Z")
// and datetime('now') is "2026-10-25 07:38:50": compared as text, "T" sorts after " ", so
// a document that expired earlier the same UTC day survived until the next day's run.
// julianday() parses both forms, so the comparison is by time.
export const DELETE_EXPIRED_DOCUMENTS =
  "DELETE FROM documents WHERE expires_at IS NOT NULL AND julianday(expires_at) < julianday('now')";
