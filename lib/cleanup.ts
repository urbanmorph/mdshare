import { KEYRING_TTL_MS } from "./keyrings.ts";

// The daily cron's delete of expired documents (src/worker.ts), here so it can be tested
// on real SQLite. expires_at holds JavaScript's ISO string ("2026-10-25T01:31:10.123Z")
// and datetime('now') is "2026-10-25 07:38:50": compared as text, "T" sorts after " ", so
// a document that expired earlier the same UTC day survived until the next day's run.
// julianday() parses both forms, so the comparison is by time.
export const DELETE_EXPIRED_DOCUMENTS =
  "DELETE FROM documents WHERE expires_at IS NOT NULL AND julianday(expires_at) < julianday('now')";

type Statement = { bind(...v: unknown[]): Statement; run(): Promise<{ meta?: { changes?: number } }> };
type DB = { prepare(sql: string): Statement };

/**
 * The daily cron: delete expired documents, stale rate-limit windows and keyrings unused for 12
 * months. It reports its own outcome in one [cleanup] line, because the ops dashboard judges the run
 * from mdshare's log lines (Cloudflare's invocation logs, which carry request URLs and their share
 * keys, are off). On failure: an error line "[cleanup] failed: <why>", then the error is rethrown so
 * Cloudflare still counts the exception.
 */
export async function runCleanup(db: DB, now: number): Promise<void> {
  try {
    const docs = await db.prepare(DELETE_EXPIRED_DOCUMENTS).run();
    const rl = await db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(now).run();
    const kr = await db.prepare("DELETE FROM keyrings WHERE used_at < ?").bind(new Date(now - KEYRING_TTL_MS).toISOString()).run();
    console.warn(
      `[cleanup] deleted ${docs.meta?.changes || 0} expired documents, ${rl.meta?.changes || 0} stale rate-limit rows, ` +
        `${kr.meta?.changes || 0} unused keyrings`
    );
  } catch (err) {
    console.error(`[cleanup] failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
