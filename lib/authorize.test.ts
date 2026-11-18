import { test } from "node:test";
import assert from "node:assert/strict";
import { authorize, authorizeDocument } from "./authorize.ts";
import { sqliteD1, addDoc, addLink } from "./test-sqlite-d1.ts";

// Every API route asks the same question: may this ?key do `need` on document `id`? A missing,
// wrong, revoked or another document's key is 404 (never a hint that the document exists); a
// key that may not do this is 403; a document past its expiry is 410, even before the daily
// cron deletes it.

const VIEW = "viw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EDIT = "edt_cccccccccccccccccccccccccccccccc";
const ADMIN = "adm_dddddddddddddddddddddddddddddddd";
const req = (key?: string) => new Request(`https://mdshare.test/api/d/doc1${key ? `?key=${key}` : ""}`);
const statusOf = (r: unknown) => (r instanceof Response ? r.status : 200);

async function setup() {
  const t = sqliteD1();
  addDoc(t.d, "doc1");
  addDoc(t.d, "doc2");
  await addLink(t.d, "doc1", VIEW, "view");
  await addLink(t.d, "doc1", EDIT, "edit");
  await addLink(t.d, "doc2", ADMIN, "admin");
  return t;
}

test("no key, a wrong key or another document's key: 404", async () => {
  const { db } = await setup();
  assert.equal(statusOf(await authorize(db, req(), "doc1", "view")), 404);
  assert.equal(statusOf(await authorize(db, req("viw_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"), "doc1", "view")), 404);
  assert.equal(statusOf(await authorize(db, req(ADMIN), "doc1", "view")), 404);
});

test("a key below the permission needed: 403", async () => {
  const { db } = await setup();
  assert.equal(statusOf(await authorize(db, req(VIEW), "doc1", "comment")), 403);
  assert.equal(statusOf(await authorize(db, req(EDIT), "doc1", "admin")), 403);
});

test("enough permission: the resolution", async () => {
  const { db } = await setup();
  const r = await authorize(db, req(EDIT), "doc1", "comment");
  assert.ok(!(r instanceof Response));
  assert.equal(r.permission, "edit");
  assert.equal(r.documentId, "doc1");
  const doc = await authorizeDocument(db, req(VIEW), "doc1", "view");
  assert.ok(!(doc instanceof Response));
  assert.equal(doc.doc.content, "# Doc doc1");
});

test("no document id: the key's own document", async () => {
  const { db } = await setup();
  const r = await authorize(db, req(ADMIN), null, "admin");
  assert.ok(!(r instanceof Response));
  assert.equal(r.documentId, "doc2");
});

test("an expired document: 410, and it is deleted", async () => {
  for (const check of [authorize, authorizeDocument]) {
    const { d, db } = sqliteD1();
    addDoc(d, "old", "Old", new Date(Date.now() - 1000).toISOString());
    await addLink(d, "old", VIEW, "view");
    const r = await check(db, req(VIEW), "old", "view");
    assert.equal(statusOf(r), 410);
    assert.deepEqual(await (r as Response).json(), { error: "Document has expired" });
    assert.equal(d.prepare("SELECT COUNT(*) AS n FROM documents").get()!.n, 0);
  }
});
