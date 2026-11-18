// The public descriptions of the MCP server (llms.txt, /.well-known/mcp.json, the README)
// must name the tools and the npm version the server actually has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOLS, VERSION } from "../mcp/src/core.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = (p: string) => JSON.parse(read(p));
const toolNames = (TOOLS as Array<{ name: string }>).map((t) => t.name).sort();

test("llms.txt lists every MCP tool", () => {
  const line = read("public/llms.txt").split("\n").find((l) => l.includes("MCP tools:")) ?? "";
  const listed = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => n.includes("_") && n !== "mdshare-tools").sort();
  assert.deepEqual(listed, toolNames);
});

test("/.well-known/mcp.json lists every MCP tool", () => {
  assert.deepEqual([...json("public/.well-known/mcp.json").tools].sort(), toolNames);
});

test("/.well-known/mcp.json names the npm version the server reports", () => {
  const wk = json("public/.well-known/mcp.json");
  assert.equal(wk.packages[0].version, VERSION);
});

test("the npm package, its lockfile and the registry entry agree on the version", () => {
  const pkg = json("mcp/package.json"), lock = json("mcp/package-lock.json"), server = json("mcp/server.json");
  assert.equal(pkg.version, VERSION);
  assert.equal(lock.version, VERSION);
  assert.equal(lock.packages[""].version, VERSION);
  // server.json's top-level version numbers the registry listing; the package inside is npm's
  assert.equal(server.packages[0].version, VERSION);
});

test("the README's MCP tool table lists every tool", () => {
  const listed = [...read("README.md").matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, toolNames);
});

// /docs (src/components/DocsContent.tsx) and /docs/raw (lib/docs-content.ts) are two copies of
// one reference: they must list the same endpoints, rate limits and error codes.
const html = read("src/components/DocsContent.tsx");
const raw = read("lib/docs-content.ts").replace(/\\`/g, "`");

test("/docs and /docs/raw list the same endpoints", () => {
  const fromHtml = [...html.matchAll(/<td><code>(GET|POST|PUT|PATCH|DELETE)<\/code><\/td><td><code>([^<]+)<\/code>/g)].map((m) => `${m[1]} ${m[2]}`).sort();
  const fromRaw = [...raw.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE)` \| `([^`]+)`/gm)].map((m) => `${m[1]} ${m[2]}`).sort();
  assert.ok(fromRaw.length > 10);
  assert.deepEqual(fromHtml, fromRaw);
});

test("/docs and /docs/raw state the same rate limits", () => {
  const fromHtml = [...html.matchAll(/<tr><td><code>([A-Z]+ \/api[^<]*)<\/code><\/td><td>([^<]+)<\/td><\/tr>/g)].map((m) => `${m[1]}: ${m[2]}`).sort();
  const fromRaw = [...raw.matchAll(/^\| `([A-Z]+ \/api[^`]*)` \| ([^|]+) \|$/gm)].map((m) => `${m[1]}: ${m[2].trim()}`).sort();
  assert.deepEqual(fromHtml, fromRaw);
});

test("/docs and /docs/raw list the same error codes", () => {
  const fromHtml = [...html.matchAll(/<td><code>([45]\d\d)<\/code><\/td>/g)].map((m) => m[1]).sort();
  const fromRaw = [...raw.matchAll(/^\| `([45]\d\d)` \|/gm)].map((m) => m[1]).sort();
  assert.deepEqual(fromHtml, fromRaw);
});

test("/docs and /docs/raw both document expiry, the hosted MCP server and the command line", () => {
  for (const [name, text] of [["/docs", html], ["/docs/raw", raw]] as const) {
    assert.match(text, /\/api\/d\/:id\/expiry/, `${name}: expiry endpoint`);
    assert.match(text, /90 days/, `${name}: default expiry`);
    assert.match(text, /mdshare\.live\/mcp/, `${name}: hosted MCP server`);
    assert.match(text, /mdshare-mcp upload/, `${name}: command line`);
  }
});

test("the README's MCP tools section names the current version and source file", () => {
  const intro = read("README.md").split("## MCP tools")[1]?.split("\n").find((l) => l.trim()) ?? "";
  assert.match(intro, new RegExp(`\\(v${VERSION.replace(/\./g, "\\.")}\\)`));
  assert.match(intro, /mcp\/src\/core\.js/);
});
