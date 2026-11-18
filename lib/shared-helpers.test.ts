import { test } from "node:test";
import assert from "node:assert/strict";
import { safeGet, safeSet, safeRemove, safeGetJson } from "./storage.ts";
import { apiUrl } from "./api-url.ts";
import { permissionBadgeClass } from "./permission-style.ts";

const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };

test("storage helpers return the fallback instead of throwing when storage is blocked", () => {
  (globalThis as { localStorage?: unknown }).localStorage = throwing;
  assert.equal(safeGet("k"), null);
  assert.doesNotThrow(() => safeSet("k", "v"));
  assert.doesNotThrow(() => safeRemove("k"));
  assert.deepEqual(safeGetJson("k", []), []);
});

test("storage helpers work, and bad JSON falls back", () => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  safeSet("a", "1");
  assert.equal(safeGet("a"), "1");
  safeRemove("a");
  assert.equal(safeGet("a"), null);
  safeSet("j", "{not json");
  assert.deepEqual(safeGetJson("j", { ok: true }), { ok: true });
  safeSet("j", '{"x":2}');
  assert.deepEqual(safeGetJson("j", {}), { x: 2 });
});

test("storage helpers are safe when there is no localStorage at all", () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  assert.equal(safeGet("k"), null);
});

test("apiUrl escapes the key and joins existing queries", () => {
  assert.equal(apiUrl("/api/d/x", "a+b/c=d"), "/api/d/x?key=a%2Bb%2Fc%3Dd");
  assert.equal(apiUrl("/api/d/x?since=1", "k"), "/api/d/x?since=1&key=k");
});

test("permissionBadgeClass has a style for every permission", () => {
  for (const p of ["admin", "edit", "comment", "view"] as const) assert.match(permissionBadgeClass(p), /^bg-\S+ text-\S+$/);
  assert.notEqual(permissionBadgeClass("admin"), permissionBadgeClass("view"));
});
