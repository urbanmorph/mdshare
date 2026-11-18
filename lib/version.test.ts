// The hosted MCP server (lib/hosted-mcp.ts) reports the same version as the npm package. The
// Worker can't import mcp/src/core.js (it uses node:fs), so the version is read from its source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_VERSION } from "./version.ts";

test("MCP_VERSION equals VERSION in mcp/src/core.js", () => {
  const core = readFileSync(new URL("../mcp/src/core.js", import.meta.url), "utf8");
  assert.equal(MCP_VERSION, core.match(/export const VERSION = "([^"]+)"/)?.[1]);
});
