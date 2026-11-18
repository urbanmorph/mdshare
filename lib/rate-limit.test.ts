import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { checkDurableRateLimit, rateLimitKey } from "./rate-limit.ts";

// The durable limiter keeps a row per (action, client) in D1 for up to a day.
// It must key that row on a salted hash of the IP, never the IP itself.

/** A real SQLite table behind the slice of the D1 API the limiter uses. */
function sqliteD1() {
  const d = new DatabaseSync(":memory:");
  d.exec(readFileSync(new URL("../migrations/0009_rate_limits.sql", import.meta.url), "utf8"));
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => d.prepare(sql).get(...(args as never[])) ?? null,
      }),
    }),
  } as unknown as D1Database;
  const keys = () => (d.prepare("SELECT key FROM rate_limits ORDER BY key").all() as { key: string }[]).map((r) => r.key);
  return { db, keys };
}

const IP = "203.0.113.7";
const CONFIG = { max: 2, windowSec: 86400 };

test("the stored key never contains the IP, and is the action plus a sha256 hex", async () => {
  const { db, keys } = sqliteD1();
  await checkDurableRateLimit(db, IP, "create-daily", CONFIG, "s3cret");
  const [key] = keys();
  assert.ok(!key.includes(IP), "raw IP must not be stored");
  assert.match(key, /^create-daily:[0-9a-f]{64}$/);
  assert.equal(key, await rateLimitKey("create-daily", IP, "s3cret"));
});

test("the hash is sha256 of salt + ':' + ip", async () => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`s3cret:${IP}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await rateLimitKey("create-daily", IP, "s3cret"), `create-daily:${hex}`);
});

test("different salts give different keys", async () => {
  assert.notEqual(await rateLimitKey("create-daily", IP, "a"), await rateLimitKey("create-daily", IP, "b"));
});

test("with no salt set it still hashes, never the raw IP", async () => {
  const { db, keys } = sqliteD1();
  await checkDurableRateLimit(db, IP, "keyring-write", CONFIG, undefined);
  const [key] = keys();
  assert.ok(!key.includes(IP));
  assert.match(key, /^keyring-write:[0-9a-f]{64}$/);
});

test("the limit is still enforced per client, and other clients are counted apart", async () => {
  const { db } = sqliteD1();
  const r1 = await checkDurableRateLimit(db, IP, "create-daily", CONFIG, "s");
  const r2 = await checkDurableRateLimit(db, IP, "create-daily", CONFIG, "s");
  const r3 = await checkDurableRateLimit(db, IP, "create-daily", CONFIG, "s");
  assert.deepEqual([r1.allowed, r2.allowed, r3.allowed], [true, true, false]);
  assert.equal(r3.remaining, 0);
  const other = await checkDurableRateLimit(db, "198.51.100.1", "create-daily", CONFIG, "s");
  assert.equal(other.allowed, true);
});
