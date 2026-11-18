import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDisplayName } from "./use-display-name.ts";
import { LIMITS } from "./limits.ts";

test("a display name is trimmed, defaults to Anonymous, and fits the server's author_name cap", () => {
  assert.equal(cleanDisplayName("  Sathya  "), "Sathya");
  assert.equal(cleanDisplayName("   "), "Anonymous");
  assert.equal(cleanDisplayName(null), "Anonymous");
  assert.equal(cleanDisplayName("सत्य"), "सत्य");
  const long = "x".repeat(LIMITS.authorName + 50);
  assert.equal(cleanDisplayName(long).length, LIMITS.authorName);
});
