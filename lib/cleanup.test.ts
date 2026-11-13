import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DELETE_EXPIRED_DOCUMENTS, runCleanup } from "./cleanup.ts";

// The daily cron's delete, run on real SQLite (D1 is SQLite). expires_at is stored as
// JavaScript's ISO string ("2026-10-25T01:31:10.123Z"), but datetime('now') returns
// "2026-10-25 07:38:50". Compared as text, "T" sorts after " ", so a document that
// expired earlier the same UTC day survived the run until the next day's.

function db(nowIso: string, docs: Record<string, string | null>) {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE documents (id TEXT PRIMARY KEY, expires_at TEXT)");
  const ins = d.prepare("INSERT INTO documents (id, expires_at) VALUES (?, ?)");
  for (const [id, exp] of Object.entries(docs)) ins.run(id, exp);
  // pin "now" so the test doesn't depend on the clock
  const sql = DELETE_EXPIRED_DOCUMENTS.replaceAll("'now'", `'${nowIso}'`);
  d.exec(sql);
  return (d.prepare("SELECT id FROM documents ORDER BY id").all() as { id: string }[]).map((r) => r.id);
}

test("deletes a document that expired earlier the same UTC day", () => {
  assert.deepEqual(db("2026-10-25 03:00:00", { sameday: "2026-10-25T01:31:10.123Z" }), []);
});

test("deletes documents that expired on earlier days", () => {
  assert.deepEqual(db("2026-10-25 03:00:00", { old: "2026-10-20T12:00:00.000Z" }), []);
});

test("keeps documents that haven't expired, later the same day or after, and ones with no expiry", () => {
  assert.deepEqual(
    db("2026-10-25 03:00:00", {
      later_today: "2026-10-25T05:30:51.277Z",
      next_year: "2027-01-21T15:14:43.945Z",
      never: null,
    }),
    ["later_today", "never", "next_year"]
  );
});

// ----- the daily run and what it logs (ops reads these lines: worker/src/collect/jobs.js) -----

/** A fake D1: answers each statement with a number of changes, or throws for the one named. */
function fakeD1(changes: number[], failOn?: RegExp) {
  const ran: string[] = [];
  let i = 0;
  const stmt = (sql: string) => ({
    bind: () => stmt(sql),
    run: async () => {
      ran.push(sql);
      if (failOn?.test(sql)) throw new Error("D1_ERROR: database is locked");
      return { meta: { changes: changes[i++] ?? 0 } };
    },
  });
  return { db: { prepare: stmt }, ran };
}

function captureLogs<T>(fn: () => Promise<T>) {
  const lines: { level: string; msg: string }[] = [];
  const orig = { warn: console.warn, error: console.error };
  console.warn = (...a: unknown[]) => { lines.push({ level: "warn", msg: a.join(" ") }); };
  console.error = (...a: unknown[]) => { lines.push({ level: "error", msg: a.join(" ") }); };
  return fn().finally(() => Object.assign(console, orig)).then((r) => ({ r, lines }), (e) => ({ e, lines }));
}

test("runCleanup: one [cleanup] line saying what each delete removed", async () => {
  const { db, ran } = fakeD1([41, 14, 2]);
  const { lines } = await captureLogs(() => runCleanup(db, Date.parse("2026-11-13T03:00:00Z")));
  assert.equal(ran.length, 3);
  assert.deepEqual(lines, [{ level: "warn", msg: "[cleanup] deleted 41 expired documents, 14 stale rate-limit rows, 2 unused keyrings" }]);
});

test("runCleanup: a failure is logged as an error line ops can read, and still fails the run", async () => {
  const { db } = fakeD1([5], /rate_limits/);
  const out = (await captureLogs(() => runCleanup(db, Date.now()))) as { e?: Error; lines: { level: string; msg: string }[] };
  assert.ok(out.e, "the run still throws, so Cloudflare counts the exception");
  assert.deepEqual(out.lines, [{ level: "error", msg: "[cleanup] failed: D1_ERROR: database is locked" }]);
});
