import { test } from "node:test";
import assert from "node:assert/strict";
import { addRecentDoc, MAX_RECENT, MAX_ADMIN, type RecentDoc } from "./recent-docs.ts";

const visit = (list: RecentDoc[], id: string, permission: string, at: number) =>
  addRecentDoc(list, { id, title: id, key: `${permission}-${id}`, permission }, at);

test("an admin key is never pushed out by later visits", () => {
  let list = visit([], "mine", "admin", 1);
  for (let i = 0; i < 50; i++) list = visit(list, `other${i}`, "view", 2 + i);
  assert.ok(list.some((d) => d.id === "mine" && d.permission === "admin"));
});

test("non-admin entries stay capped at MAX_RECENT", () => {
  let list: RecentDoc[] = [];
  for (let i = 0; i < 30; i++) list = visit(list, `v${i}`, "edit", i);
  assert.equal(list.filter((d) => d.permission !== "admin").length, MAX_RECENT);
  assert.equal(list[0].id, "v29"); // newest first
});

test("admin entries are bounded by MAX_ADMIN, oldest dropped", () => {
  let list: RecentDoc[] = [];
  for (let i = 0; i < MAX_ADMIN + 5; i++) list = visit(list, `a${i}`, "admin", i);
  assert.equal(list.length, MAX_ADMIN);
  assert.ok(!list.some((d) => d.id === "a0"));
});

test("revisiting a doc with the same key moves it to the front without duplicating", () => {
  let list = visit([], "x", "admin", 1);
  list = visit(list, "y", "view", 2);
  list = visit(list, "x", "admin", 3);
  assert.deepEqual(list.map((d) => d.id), ["x", "y"]);
  assert.equal(list[0].visitedAt, 3);
});

test("the list stays newest-first across admin and non-admin entries", () => {
  let list = visit([], "a", "admin", 1);
  list = visit(list, "b", "view", 2);
  list = visit(list, "c", "admin", 3);
  assert.deepEqual(list.map((d) => d.id), ["c", "b", "a"]);
});

test("the snapshot is referentially stable until storage changes (useSyncExternalStore)", async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const { getRecentDocsSnapshot, saveRecentDoc } = await import("./recent-docs.ts");
  const a = getRecentDocsSnapshot();
  assert.equal(getRecentDocsSnapshot(), a);
  saveRecentDoc({ id: "d", title: "d", key: "k", permission: "admin" });
  const b = getRecentDocsSnapshot();
  assert.notEqual(b, a);
  assert.equal(b[0].id, "d");
  assert.equal(getRecentDocsSnapshot(), b);
});
