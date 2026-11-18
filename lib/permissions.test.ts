import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDocument, resolveAccess, findLink, isExpired } from "./permissions.ts";
import { sqliteD1, addDoc, addLink } from "./test-sqlite-d1.ts";

// resolveDocument answers "may this key open this document, and what is in it?"
// in one D1 round trip. It must refuse exactly what resolveToken + a separate
// documents lookup refused: unknown keys, another document's key, revoked links,
// expired links, and documents that no longer exist.

const VIEW = "viw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMENT = "cmt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EDIT = "edt_cccccccccccccccccccccccccccccccc";
const ADMIN = "adm_dddddddddddddddddddddddddddddddd";

test("each permission level opens its own document, with the document's row", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1", "Hello");
  await addLink(d, "doc1", VIEW, "view");
  await addLink(d, "doc1", COMMENT, "comment");
  await addLink(d, "doc1", EDIT, "edit");
  await addLink(d, "doc1", ADMIN, "admin");
  for (const [token, perm] of [[VIEW, "view"], [COMMENT, "comment"], [EDIT, "edit"], [ADMIN, "admin"]]) {
    const r = await resolveDocument(db, token, "doc1");
    assert.ok(r, `${perm} link should open`);
    assert.equal(r.permission, perm);
    assert.equal(r.linkId, `link-${token}`);
    assert.equal(r.documentId, "doc1");
    assert.equal(r.doc.id, "doc1");
    assert.equal(r.doc.title, "Hello");
    assert.equal(r.doc.content, "# Hello");
    assert.equal(r.doc.expires_at, "2099-01-01T00:00:00.000Z", "the document's expiry, not the link's");
  }
});

test("the document row carries no link columns (no token hash leaks into the page)", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  await addLink(d, "doc1", VIEW, "view");
  const r = await resolveDocument(db, VIEW, "doc1");
  assert.ok(r);
  assert.deepEqual(Object.keys(r.doc).sort(), Object.keys(d.prepare("SELECT * FROM documents").get()!).sort());
});

test("it takes one database round trip", async () => {
  const { d, db, roundTrips } = sqliteD1();
  addDoc(d, "doc1");
  await addLink(d, "doc1", VIEW, "view");
  await resolveDocument(db, VIEW, "doc1");
  assert.equal(roundTrips(), 1);
});

test("a wrong key is refused", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  await addLink(d, "doc1", VIEW, "view");
  assert.equal(await resolveDocument(db, "viw_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "doc1"), null);
  // same 8-char prefix, different token: the hash check still refuses it
  assert.equal(await resolveDocument(db, "viw_aaaazzzzzzzzzzzzzzzzzzzzzzzzzzzz", "doc1"), null);
  assert.equal(await resolveDocument(db, "", "doc1"), null);
});

test("another document's key does not open this document", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  addDoc(d, "doc2");
  await addLink(d, "doc2", ADMIN, "admin");
  assert.equal(await resolveDocument(db, ADMIN, "doc1"), null);
  assert.ok(await resolveDocument(db, ADMIN, "doc2"));
});

test("a revoked link is refused", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  await addLink(d, "doc1", VIEW, "view", { active: 0 });
  assert.equal(await resolveDocument(db, VIEW, "doc1"), null);
});

test("an expired link is refused; one expiring later still opens", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  await addLink(d, "doc1", VIEW, "view", { expiresAt: new Date(Date.now() - 1000).toISOString() });
  await addLink(d, "doc1", EDIT, "edit", { expiresAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(await resolveDocument(db, VIEW, "doc1"), null);
  assert.equal((await resolveDocument(db, EDIT, "doc1"))?.permission, "edit");
});

test("a link whose document is gone is refused", async () => {
  const { d, db } = sqliteD1();
  // links.document_id references documents, but SQLite only enforces that with
  // PRAGMA foreign_keys; insert the orphan the way a half-finished delete would leave it
  d.exec("PRAGMA foreign_keys = OFF");
  await addLink(d, "gone", VIEW, "view");
  assert.equal(await resolveDocument(db, VIEW, "gone"), null);
});

test("prefix collisions: the candidate whose hash matches wins, inactive ones are skipped", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  const twin = "viw_aaaaYYYYYYYYYYYYYYYYYYYYYYYYYYYY"; // same prefix as VIEW
  await addLink(d, "doc1", twin, "edit", { id: "twin" });
  await addLink(d, "doc1", VIEW, "view");
  assert.equal((await resolveDocument(db, VIEW, "doc1"))?.permission, "view");
  assert.equal((await resolveDocument(db, twin, "doc1"))?.linkId, "twin");
});

// ----- resolveAccess: the light version for API routes (no content), with the document's expiry -----

test("resolveAccess: the permission and the document's expiry, in one round trip, without the content", async () => {
  const { d, db, roundTrips } = sqliteD1();
  addDoc(d, "doc1", "T", "2001-01-01T00:00:00.000Z");
  await addLink(d, "doc1", EDIT, "edit");
  const r = await resolveAccess(db, EDIT, "doc1");
  assert.deepEqual(r, { permission: "edit", documentId: "doc1", linkId: `link-${EDIT}`, docExpiresAt: "2001-01-01T00:00:00.000Z" });
  assert.equal(roundTrips(), 1);
});

test("resolveAccess: refuses what resolveDocument refuses", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  addDoc(d, "doc2");
  await addLink(d, "doc2", ADMIN, "admin");
  await addLink(d, "doc1", VIEW, "view", { active: 0 });
  await addLink(d, "doc1", EDIT, "edit", { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await resolveAccess(db, ADMIN, "doc1"), null, "another document's key");
  assert.equal(await resolveAccess(db, VIEW, "doc1"), null, "revoked");
  assert.equal(await resolveAccess(db, EDIT, "doc1"), null, "expired link");
  assert.equal(await resolveAccess(db, "", "doc1"), null);
});

test("resolveAccess with no document id: whichever document the key opens", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc2");
  await addLink(d, "doc2", ADMIN, "admin");
  assert.equal((await resolveAccess(db, ADMIN, null))?.documentId, "doc2");
});

test("isExpired: a past date is expired; a future one or none is not", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.equal(isExpired("2026-11-18T11:59:59.000Z", now), true);
  assert.equal(isExpired("2026-11-18T12:00:01.000Z", now), false);
  assert.equal(isExpired(null, now), false);
});

// ----- findLink: an admin addresses one of its document's links by id or by token -----

test("findLink: by id or by token, including revoked and expired links", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  await addLink(d, "doc1", VIEW, "view", { id: "L1", active: 0 });
  await addLink(d, "doc1", EDIT, "edit", { id: "L2", expiresAt: "2001-01-01T00:00:00.000Z" });
  assert.deepEqual(await findLink(db, "doc1", "L1"), { id: "L1", permission: "view" });
  assert.deepEqual(await findLink(db, "doc1", VIEW), { id: "L1", permission: "view" });
  assert.deepEqual(await findLink(db, "doc1", EDIT), { id: "L2", permission: "edit" });
});

test("findLink: never another document's link, nor a token that only shares the prefix", async () => {
  const { d, db } = sqliteD1();
  addDoc(d, "doc1");
  addDoc(d, "doc2");
  await addLink(d, "doc2", VIEW, "view", { id: "other" });
  await addLink(d, "doc1", EDIT, "edit", { id: "mine" });
  assert.equal(await findLink(db, "doc1", "other"), null);
  assert.equal(await findLink(db, "doc1", VIEW), null);
  assert.equal(await findLink(db, "doc1", "edt_ccccZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"), null);
  assert.equal(await findLink(db, "doc1", ""), null);
});
