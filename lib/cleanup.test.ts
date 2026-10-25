import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DELETE_EXPIRED_DOCUMENTS } from "./cleanup.ts";

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
