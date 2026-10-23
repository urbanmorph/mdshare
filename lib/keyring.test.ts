import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveKeys, deriveKeysFrom, newSecret, sealJson, unsealJson, syncDoc, syncSecretFrom, SyncGone,
  type KeyringApi, type KeyringCodec,
} from "./keyring.ts";

// The browser side of the encrypted keyring (same design as bharatlas's, own label).

test("the same secret always derives the same id and keys; another secret doesn't", async () => {
  const s = newSecret();
  const [a, b, c] = await Promise.all([deriveKeys(s), deriveKeys(s), deriveKeys(newSecret())]);
  assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.match(a.writeKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(a.id, b.id);
  assert.equal(a.writeKey, b.writeKey);
  assert.notEqual(a.id, c.id);
});

test("mdshare's keys are its own: they differ from bharatlas's for the same bytes", async () => {
  const bytes = new Uint8Array(32).fill(7);
  const mine = await deriveKeysFrom(bytes);
  const collect = await deriveKeysFrom(bytes, "collect-keyring");
  assert.notEqual(mine.id, collect.id);
});

test("a sealed document opens only with its key, and never contains the plain text", async () => {
  const k = await deriveKeys(newSecret());
  const blob = await sealJson(k.encKey, { secret: "admin-key-123" });
  assert.equal(blob.includes("admin-key-123"), false);
  assert.deepEqual(await unsealJson(k.encKey, blob), { secret: "admin-key-123" });
  const other = await deriveKeys(newSecret());
  await assert.rejects(unsealJson(other.encKey, blob));
});

test("a sync link's secret is read from the address, and nothing else is", () => {
  const s = newSecret();
  assert.equal(syncSecretFrom(`#sync=${s}`), s);
  assert.equal(syncSecretFrom("#sync=short"), null);
  assert.equal(syncSecretFrom("#other"), null);
});

const setCodec: KeyringCodec<string[]> = {
  seal: (k, v) => sealJson(k, v),
  unseal: (k, b) => unsealJson<string[]>(k, b),
  merge: (a, b) => [...new Set([...a, ...b])].sort(),
};

function memoryApi(): KeyringApi & { rows: Map<string, { blob: string; updated_at: string }> } {
  const rows = new Map<string, { blob: string; updated_at: string }>();
  let n = 0;
  return {
    rows,
    async get(id) { return rows.get(id) ?? null; },
    async put(id, _w, blob, base) {
      const cur = rows.get(id);
      if (cur && cur.updated_at !== base) return { conflict: cur };
      const updated_at = String(++n);
      rows.set(id, { blob, updated_at });
      return { updated_at };
    },
  };
}

test("two devices syncing end up with the union of both lists", async () => {
  const api = memoryApi();
  const k = await deriveKeys(newSecret());
  await syncDoc(k, ["a", "b"], api, setCodec);
  const second = await syncDoc(k, ["c"], api, setCodec);
  assert.deepEqual(second.value, ["a", "b", "c"]);
});

test("a device that synced before and finds no copy stops (turned off elsewhere)", async () => {
  const k = await deriveKeys(newSecret());
  await assert.rejects(syncDoc(k, ["a"], memoryApi(), setCodec, { joined: true }), SyncGone);
});
