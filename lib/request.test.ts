import { test } from "node:test";
import assert from "node:assert/strict";
import { readJson, decodeHeader, authorName, tooLong, parseFutureDate, rateLimit, LIMITS } from "./request.ts";

const post = (body: string) => new Request("https://mdshare.test/x", { method: "POST", body });

test("readJson: an object body is parsed", async () => {
  assert.deepEqual(await readJson(post('{"a":1}')), { a: 1 });
});

test("readJson: bad JSON, an empty body or a non-object is a 400, not a crash", async () => {
  for (const body of ["{", "", "null", "[1]", '"text"', "42"]) {
    const r = await readJson(post(body));
    assert.ok(r instanceof Response, body);
    assert.equal(r.status, 400, body);
    assert.deepEqual(await r.json(), { error: "Invalid JSON body" });
  }
});

test("decodeHeader: a percent-encoded name is decoded; a raw ASCII one is kept as sent", () => {
  assert.equal(decodeHeader(encodeURIComponent("सत्य")), "सत्य");
  assert.equal(decodeHeader(encodeURIComponent("Ana María")), "Ana María");
  assert.equal(decodeHeader("Claude"), "Claude");
  assert.equal(decodeHeader("100% sure"), "100% sure"); // not valid percent-encoding: kept raw
  assert.equal(decodeHeader(null), null);
});

test("authorName: the first non-empty candidate, trimmed and capped, else Anonymous", () => {
  assert.equal(authorName(undefined, "  Ann  "), "Ann");
  assert.equal(authorName("", null), "Anonymous");
  assert.equal(authorName(42 as unknown as string, "Bo"), "Bo");
  assert.equal(authorName("x".repeat(500)).length, LIMITS.authorName);
});

test("tooLong: a 400 naming the first field over its cap", async () => {
  assert.equal(tooLong([["content", "abc", 3]]), null);
  assert.equal(tooLong([["content", undefined, 3]]), null);
  const r = tooLong([["content", "ok", 3], ["label", "abcd", 3]]);
  assert.ok(r);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "label is too long (max 3 characters)" });
});

test("parseFutureDate: a future ISO date is stored as toISOString()", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.deepEqual(parseFutureDate("2026-12-01", { now }), { iso: "2026-12-01T00:00:00.000Z" });
});

test("parseFutureDate: missing, not a date, past or beyond the horizon is an error", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.match(parseFutureDate(undefined, { now }).error!, /required/);
  assert.match(parseFutureDate(42, { now }).error!, /required/);
  assert.match(parseFutureDate("next tuesday", { now }).error!, /not a valid date/);
  assert.match(parseFutureDate("2026-11-18T11:00:00Z", { now }).error!, /future/);
  assert.match(parseFutureDate("2028-01-01", { now, maxAheadMs: 365 * 864e5 }).error!, /1 year/);
});

test("rateLimit: null while allowed, then a 429 for the same client and action", () => {
  const r = new Request("https://mdshare.test/x", { headers: { "cf-connecting-ip": "203.0.113.9" } });
  const action = `test-${Math.random()}`;
  assert.equal(rateLimit(r, action, { max: 2, windowSec: 60 }), null);
  assert.equal(rateLimit(r, action, { max: 2, windowSec: 60 }), null);
  assert.equal(rateLimit(r, action, { max: 2, windowSec: 60 })?.status, 429);
});
