import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecentSync, mergeRecent } from "./recent-sync.ts";
import { MAX_RECENT, type RecentDoc } from "./recent-docs.ts";
import type { KeyringServer } from "./keyring.ts";

// "Recent documents" on all your devices: the list (with its admin keys) syncs
// end to end encrypted; mdshare's server sees ciphertext only.

const doc = (id: string, permission: string, visitedAt: number, title = id): RecentDoc =>
  ({ id, title, key: `${permission}-${id}`, permission, visitedAt });

test("merging keeps each document+key once, the latest visit's title, newest first", () => {
  const merged = mergeRecent(
    [doc("a", "admin", 1, "Old title"), doc("b", "view", 5)],
    [doc("a", "admin", 9, "New title"), doc("c", "edit", 3)],
  );
  assert.deepEqual(merged.map((d) => [d.id, d.title]), [["a", "New title"], ["b", "b"], ["c", "c"]]);
});

test("merging never drops an admin key, and keeps other visits capped", () => {
  const visits = Array.from({ length: 30 }, (_, i) => doc(`v${i}`, "view", 100 + i));
  const merged = mergeRecent([doc("mine", "admin", 1)], visits);
  assert.ok(merged.some((d) => d.id === "mine"));
  assert.equal(merged.filter((d) => d.permission !== "admin").length, MAX_RECENT);
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function memoryServer(): KeyringServer & { rows: Map<string, { blob: string; updated_at: string }> } {
  const rows = new Map<string, { blob: string; updated_at: string }>();
  let n = 0;
  return {
    rows,
    async get(id) { return rows.get(id) ?? null; },
    async put(id, _w, blob, base) {
      const cur = rows.get(id);
      if (!cur && base) {
        const { SyncGone } = await import("./keyring.ts");
        throw new SyncGone("sync was turned off on another device");
      }
      if (cur && cur.updated_at !== base) return { conflict: cur };
      const updated_at = String(++n);
      rows.set(id, { blob, updated_at });
      return { updated_at };
    },
    async delete(id) { rows.delete(id); },
  };
}

const RECENT = "mdshare_recent";
const seed = (s: Storage, docs: RecentDoc[]) => s.setItem(RECENT, JSON.stringify(docs));
const device = (api: KeyringServer, prf = new Uint8Array(32).fill(3)) => {
  const storage = memoryStorage();
  const sync = createRecentSync({ api, storage, passkey: { create: async () => prf, get: async () => prf } });
  return { storage, sync };
};

test("turn on, open the link on another device: both have both lists, and the server sees no keys", async () => {
  const api = memoryServer();
  const laptop = device(api);
  seed(laptop.storage, [doc("plan", "admin", 1)]);
  await laptop.sync.turnOn();
  const phone = device(api);
  seed(phone.storage, [doc("notes", "edit", 2)]);
  const link = laptop.sync.link("https://mdshare.live")!;
  assert.match(link, /^https:\/\/mdshare\.live\/#sync=[A-Za-z0-9_-]{43}$/);
  await phone.sync.join(link.split("#sync=")[1]);
  assert.deepEqual(phone.sync.list().map((d) => d.id).sort(), ["notes", "plan"]);
  await laptop.sync.syncNow();
  assert.deepEqual(laptop.sync.list().map((d) => d.id).sort(), ["notes", "plan"]);
  for (const row of api.rows.values()) assert.equal(/admin-plan|edit-notes/.test(row.blob), false);
});

test("a passkey brings everything back on a wiped device", async () => {
  const api = memoryServer();
  const laptop = device(api);
  seed(laptop.storage, [doc("plan", "admin", 1)]);
  await laptop.sync.turnOn();
  await laptop.sync.addPasskey();
  const fresh = device(api);
  await fresh.sync.unlockWithPasskey();
  assert.deepEqual(fresh.sync.list().map((d) => d.key), ["admin-plan"]);
});

test("turning off deletes the synced copy and the passkey's, and other devices stop", async () => {
  const api = memoryServer();
  const laptop = device(api);
  seed(laptop.storage, [doc("plan", "admin", 1)]);
  await laptop.sync.turnOn();
  await laptop.sync.addPasskey();
  const phone = device(api);
  await phone.sync.join(laptop.sync.link("https://mdshare.live")!.split("#sync=")[1]);
  await laptop.sync.turnOff();
  assert.equal(api.rows.size, 0);
  assert.equal(laptop.sync.state(), null);
  await assert.rejects(phone.sync.syncNow());
  assert.equal(phone.sync.state(), null);
  assert.deepEqual(phone.sync.list().map((d) => d.id), ["plan"]); // keeps what it had
});

test("errors read plainly: a cancelled passkey, no connection, or the reason", async () => {
  const { syncErrorText } = await import("./recent-sync.ts");
  assert.equal(syncErrorText(Object.assign(new Error("x"), { name: "NotAllowedError" })), "Passkey cancelled.");
  assert.match(syncErrorText(new TypeError("Failed to fetch")), /Couldn't reach mdshare/);
  assert.match(syncErrorText(new Error("anything"), false), /Couldn't reach mdshare/);
  assert.equal(syncErrorText(new Error("sync kept conflicting, try again")), "sync kept conflicting, try again");
});
