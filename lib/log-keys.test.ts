// Share keys travel in API URLs (?key=...). No log line may carry one: the Worker logs URLs only
// through logUrl (lib/ws-errors.ts), and Cloudflare's invocation logs, which keep every request URL,
// are off (wrangler.jsonc).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the Worker never logs a raw request URL", () => {
  for (const f of ["src/worker.ts", "worker/document-ws.ts"]) {
    assert.doesNotMatch(read(f), /url:\s*request\.url/, f);
  }
});

test("Cloudflare's invocation logs, which keep each request URL, are off", () => {
  assert.match(read("wrangler.jsonc"), /"invocation_logs":\s*false/);
});
