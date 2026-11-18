import { test } from "node:test";
import assert from "node:assert/strict";
import { insertShareLink, MAX_ACTIVE_LINKS } from "./links.ts";
import { sqliteD1, addDoc, addLink } from "./test-sqlite-d1.ts";

// The cap is on links that still work: revoked and expired ones don't count, so an admin who
// revoked links can make new ones. The documents_shared stat counts a document's first share link.

const row = (n: number) => ({
  id: `L${n}`,
  documentId: "doc1",
  prefix: `viw_${String(n).padStart(4, "0")}`,
  hash: `h${n}`,
  permission: "view" as const,
  label: null,
  token: null,
  expiresAt: null,
});
const stat = (d: ReturnType<typeof sqliteD1>["d"]) =>
  (d.prepare("SELECT value FROM stats WHERE key = 'documents_shared'").get() as { value: number }).value;

test("up to the cap of active links, then refused", async () => {
  const { d, db, roundTrips } = sqliteD1();
  addDoc(d, "doc1");
  await addLink(d, "doc1", "adm_dddddddddddddddddddddddddddddddd", "admin"); // the admin link doesn't count
  const before = roundTrips();
  for (let n = 0; n < MAX_ACTIVE_LINKS; n++) assert.equal(await insertShareLink(db, row(n)), true, `link ${n}`);
  assert.equal(roundTrips() - before, MAX_ACTIVE_LINKS, "one round trip per link");
  assert.equal(await insertShareLink(db, row(99)), false);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM links WHERE permission != 'admin'").get()!.n, MAX_ACTIVE_LINKS);
});

test("revoked and expired links don't count toward the cap", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  for (let n = 0; n < MAX_ACTIVE_LINKS; n++) await insertShareLink(db, row(n));
  d.prepare("UPDATE links SET is_active = 0 WHERE id = 'L0'").run();
  assert.equal(await insertShareLink(db, row(100)), true);
  assert.equal(await insertShareLink(db, row(101)), false);
  d.prepare("UPDATE links SET expires_at = '2001-01-01T00:00:00.000Z' WHERE id = 'L1'").run();
  assert.equal(await insertShareLink(db, row(102)), true);
});

test("documents_shared counts a document's first share link only", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  const start = stat(d);
  await insertShareLink(db, row(1));
  await insertShareLink(db, row(2));
  assert.equal(stat(d), start + 1);
});
