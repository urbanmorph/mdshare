// The Worker (src/worker.ts) sets these headers on dynamic responses; public/_headers sets them
// on static files, which never reach the Worker. They must say the same thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SECURITY_HEADERS } from "./security-headers.ts";

function allPathsRule(): Record<string, string> {
  const out: Record<string, string> = {};
  let inRule = false;
  for (const line of readFileSync(new URL("../public/_headers", import.meta.url), "utf8").split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    if (!/^\s/.test(line)) { inRule = line.trim() === "/*"; continue; }
    if (!inRule) continue;
    const i = line.indexOf(":");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

test("public/_headers sets the same security headers as the Worker, CSP included", () => {
  assert.deepEqual(allPathsRule(), SECURITY_HEADERS);
  assert.match(SECURITY_HEADERS["Content-Security-Policy"], /frame-ancestors 'none'/);
});
