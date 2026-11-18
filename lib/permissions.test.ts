import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolveDocument } from "./permissions.ts";
import { hashToken, tokenPrefix } from "./tokens.ts";

// resolveDocument answers "may this key open this document, and what is in it?"
// in one D1 round trip. It must refuse exactly what resolveToken + a separate
// documents lookup refused: unknown keys, another document's key, revoked links,
// expired links, and documents that no longer exist.

/** Real SQLite with the production schema, behind the slice of D1 it uses; counts round trips. */
function sqliteD1() {
  const d = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    d.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  let roundTrips = 0;
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => {
          roundTrips++;
          return { results: d.prepare(sql).all(...(args as never[])) };
        },
        first: async () => {
          roundTrips++;
          return d.prepare(sql).get(...(args as never[])) ?? null;
        },
      }),
    }),
  } as unknown as D1Database;
  return { d, db, roundTrips: () => roundTrips };
}

function addDoc(d: DatabaseSync, id: string, title = `Doc ${id}`) {
  d.prepare(
    "INSERT INTO documents (id, title, content, content_hash, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, title, `# ${title}`, `hash-${id}`, "2099-01-01T00:00:00.000Z");
}

async function addLink(
  d: DatabaseSync,
  docId: string,
  token: string,
  permission: string,
  opts: { active?: number; expiresAt?: string | null; id?: string } = {}
) {
  d.prepare(
    `INSERT INTO links (id, document_id, token_prefix, token_hash, permission, is_active, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.id ?? `link-${token}`,
    docId,
    tokenPrefix(token),
    await hashToken(token),
    permission,
    opts.active ?? 1,
    opts.expiresAt ?? null
  );
}

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
