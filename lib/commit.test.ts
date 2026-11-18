import { test } from "node:test";
import assert from "node:assert/strict";
import { commitContent, applyOperations } from "./commit.ts";
import { titleFrom } from "./sanitize.ts";
import { sqliteD1, addDoc } from "./test-sqlite-d1.ts";

// A save (PUT or PATCH) commits new content against the content it was based on. Two writers
// that read the same content must not both win: the second one's UPDATE finds the hash moved
// and answers 409, and its version row is not written either.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Record<string, any>;

async function setup() {
  const t = sqliteD1();
  addDoc(t.d, "doc1", "Doc doc1");
  const current = t.d.prepare("SELECT content, content_hash FROM documents WHERE id = 'doc1'").get() as {
    content: string;
    content_hash: string;
  };
  return { ...t, current };
}

const opts = (current: { content: string; content_hash: string }, raw: string, more: object = {}) => ({
  current,
  raw,
  baseHash: null,
  editedVia: "api",
  editedBy: "Ann",
  t0: Date.now(),
  ...more,
});

test("an update: new content, hash and title, one version of the old content, and a broadcast", async () => {
  const { d, db, current } = await setup();
  const sent: unknown[] = [];
  const r = await commitContent(db, "doc1", opts(current, "# New title\n\nbody", {
    broadcast: async (...a: unknown[]) => { sent.push(a); },
  }));
  assert.equal(r.status, 200);
  const body = await json(r);
  assert.equal(body.status, "updated");
  const row = d.prepare("SELECT title, content, content_hash FROM documents").get() as Record<string, string>;
  assert.equal(row.title, "New title");
  assert.equal(row.content_hash, body.content_hash);
  assert.match(row.content, /^# New title/);
  const versions = d.prepare("SELECT content, content_hash, edited_by FROM versions").all().map((v: object) => ({ ...v }));
  assert.deepEqual(versions, [{ content: current.content, content_hash: current.content_hash, edited_by: "Ann" }]);
  assert.deepEqual(sent, [["doc1", row.content, row.content_hash]]);
  assert.match(r.headers.get("server-timing")!, /sanitize;dur=\d+, db;dur=\d+, total;dur=\d+/);
});

test("two writers from the same base: the second gets 409 and writes nothing", async () => {
  for (const baseHash of [null, "base"]) {
    const { d, db, current } = await setup();
    const base = baseHash && current.content_hash;
    const a = await commitContent(db, "doc1", opts(current, "# A", { baseHash: base }));
    const b = await commitContent(db, "doc1", opts(current, "# B", { baseHash: base }));
    assert.equal(a.status, 200);
    assert.equal(b.status, 409);
    const conflict = await json(b);
    assert.equal(conflict.error, "conflict");
    assert.match(conflict.content, /^# A/);
    assert.equal(conflict.content_hash, (await json(a)).content_hash);
    assert.equal(d.prepare("SELECT COUNT(*) AS n FROM versions").get()!.n, 1, "only the winner's version");
    assert.match((d.prepare("SELECT content FROM documents").get() as { content: string }).content, /^# A/);
  }
});

test("a stale base hash is a 409 before anything is written", async () => {
  const { d, db, current } = await setup();
  const r = await commitContent(db, "doc1", opts(current, "# X", { baseHash: "older" }));
  assert.equal(r.status, 409);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM versions").get()!.n, 0);
});

test("the same content again is 'unchanged', with its hash, and writes nothing", async () => {
  const { d, db, current } = await setup();
  const first = await json(await commitContent(db, "doc1", opts(current, "# Same")));
  const now = d.prepare("SELECT content, content_hash FROM documents").get() as typeof current;
  const r = await commitContent(db, "doc1", opts(now, "# Same"));
  assert.deepEqual({ ...(await json(r)), processing_ms: 0 }, { status: "unchanged", content_hash: first.content_hash, processing_ms: 0 });
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM versions").get()!.n, 1);
});

test("content without an H1 keeps the title", async () => {
  const { d, db, current } = await setup();
  await commitContent(db, "doc1", opts(current, "no heading"));
  assert.equal((d.prepare("SELECT title FROM documents").get() as { title: string }).title, "Doc doc1");
});

test("extra fields ride along in the reply", async () => {
  const { db, current } = await setup();
  const r = await commitContent(db, "doc1", opts(current, "# E", { extra: { applied: 1 } }));
  assert.equal((await json(r)).applied, 1);
});

test("titleFrom: the first H1, cleaned and capped like an X-Title; null without one", () => {
  assert.equal(titleFrom("intro\n# Hello  world \nmore"), "Hello world");
  assert.equal(titleFrom("# a‮b"), "ab");
  assert.equal(titleFrom(`# ${"x".repeat(300)}`)!.length, 200);
  assert.equal(titleFrom("## not h1"), null);
  assert.equal(titleFrom("# ​"), null);
});

// ----- PATCH operations -----

test("applyOperations: unique, replace_all, not found, ambiguous and invalid", () => {
  const r = applyOperations("a b a c", [
    { find: "b", replace: "B" },
    { find: "a", replace: "A" },
    { find: "a", replace: "Z", replace_all: true },
    { find: "zzz", replace: "" },
    { find: 1, replace: "x" },
    { find: "c", replace: 2 },
    "nonsense",
  ]);
  assert.ok(!(r instanceof Response));
  assert.equal(r.content, "Z B Z c");
  assert.equal(r.applied, 2);
  assert.deepEqual(r.results.map((x) => x.status), ["ok", "ambiguous", "ok", "not_found", "invalid", "invalid", "invalid"]);
});

test("applyOperations: no operations array is a 400", () => {
  for (const ops of [undefined, [], "x", {}]) {
    const r = applyOperations("a", ops);
    assert.ok(r instanceof Response);
    assert.equal(r.status, 400);
  }
});
