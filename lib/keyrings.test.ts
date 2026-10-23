import { test } from "node:test";
import assert from "node:assert/strict";
import { getKeyring, putKeyring, deleteKeyring, type KeyringStore } from "./keyrings.ts";

// The server side of "Recent documents" sync: it stores an encrypted blob per
// keyring id, gated by a write key it keeps only as a hash.

function memoryStore(): KeyringStore & { rows: Map<string, { write_hash: string; blob: string; updated_at: string }> } {
  const rows = new Map<string, { write_hash: string; blob: string; updated_at: string }>();
  let clock = 0;
  const stamp = () => `2026-10-23T00:00:${String(++clock).padStart(2, "0")}.000Z`;
  return {
    rows,
    async get(id) {
      const r = rows.get(id);
      return r ? { id, ...r } : null;
    },
    async touch() {},
    async insert(id, write_hash, blob) {
      const updated_at = stamp();
      rows.set(id, { write_hash, blob, updated_at });
      return updated_at;
    },
    async update(id, blob, base) {
      const r = rows.get(id);
      if (!r || r.updated_at !== base) return null;
      r.blob = blob;
      r.updated_at = stamp();
      return r.updated_at;
    },
    async delete(id) {
      rows.delete(id);
    },
  };
}

const ID = "0123456789abcdef0123456789abcdef";
const KEY = "k".repeat(43);
const OTHER = "x".repeat(43);
const body = async (r: Response) => ({ status: r.status, json: (await r.json()) as Record<string, unknown> });

test("a new keyring is created, read back, and the server keeps only the write key's hash", async () => {
  const s = memoryStore();
  const put = await body(await putKeyring(s, ID, KEY, { blob: "abc_-123", base: null }));
  assert.equal(put.status, 200);
  assert.ok(put.json.updated_at);
  assert.notEqual(s.rows.get(ID)!.write_hash, KEY);
  const got = await body(await getKeyring(s, ID));
  assert.deepEqual(got, { status: 200, json: { blob: "abc_-123", updated_at: put.json.updated_at } });
});

test("an unknown keyring is a 404; a malformed id is a 400", async () => {
  const s = memoryStore();
  assert.equal((await getKeyring(s, ID)).status, 404);
  assert.equal((await getKeyring(s, "not-an-id")).status, 400);
});

test("only the write key can update or delete it", async () => {
  const s = memoryStore();
  const { json } = await body(await putKeyring(s, ID, KEY, { blob: "one", base: null }));
  assert.equal((await putKeyring(s, ID, OTHER, { blob: "evil", base: json.updated_at as string })).status, 401);
  assert.equal((await putKeyring(s, ID, null, { blob: "evil", base: null })).status, 401);
  assert.equal((await deleteKeyring(s, ID, OTHER)).status, 401);
  assert.equal(s.rows.get(ID)!.blob, "one");
  assert.equal((await deleteKeyring(s, ID, KEY)).status, 200);
  assert.equal(s.rows.has(ID), false);
});

test("a write against an older version is a 409 with the current copy, so the device merges", async () => {
  const s = memoryStore();
  const first = await body(await putKeyring(s, ID, KEY, { blob: "one", base: null }));
  await putKeyring(s, ID, KEY, { blob: "two", base: first.json.updated_at as string });
  const stale = await body(await putKeyring(s, ID, KEY, { blob: "three", base: first.json.updated_at as string }));
  assert.equal(stale.status, 409);
  assert.equal(stale.json.blob, "two");
});

test("a device writing to a deleted copy is told sync was turned off (410), not given a new one", async () => {
  const s = memoryStore();
  const first = await body(await putKeyring(s, ID, KEY, { blob: "one", base: null }));
  await deleteKeyring(s, ID, KEY);
  assert.equal((await putKeyring(s, ID, KEY, { blob: "again", base: first.json.updated_at as string })).status, 410);
  assert.equal(s.rows.has(ID), false);
});

test("rejects blobs that are missing, not base64url, or over 256 KB", async () => {
  const s = memoryStore();
  assert.equal((await putKeyring(s, ID, KEY, {})).status, 400);
  assert.equal((await putKeyring(s, ID, KEY, { blob: "<script>" })).status, 400);
  assert.equal((await putKeyring(s, ID, KEY, { blob: "a".repeat(262_145) })).status, 413);
});
