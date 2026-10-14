import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaleWrite } from "./base-hash.ts";

test("a write based on the current version is not stale", () => {
  assert.equal(isStaleWrite("abc", "abc"), false);
});

test("a write based on an older version is stale", () => {
  assert.equal(isStaleWrite("old", "new"), true);
});

test("a write with no base hash keeps last-write-wins", () => {
  assert.equal(isStaleWrite(null, "new"), false);
  assert.equal(isStaleWrite(undefined, "new"), false);
  assert.equal(isStaleWrite("", "new"), false);
});
