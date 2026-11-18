// The public descriptions of the MCP server (llms.txt, /.well-known/mcp.json, the README)
// must name the tools and the npm version the server actually has. /docs and /docs/raw
// are one reference: lib/docs-content.ts holds the markdown, /docs/raw serves it as is and
// /docs renders it to HTML at build time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { TOOLS, VERSION } from "../mcp/src/core.js";
import { DOCS_MARKDOWN, renderDocsHtml } from "./docs-content.ts";

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

test("the README's MCP tools section names the current version and source file", () => {
  const intro = read("README.md").split("## MCP tools")[1]?.split("\n").find((l) => l.trim()) ?? "";
  assert.match(intro, new RegExp(`\\(v${VERSION.replace(/\./g, "\\.")}\\)`));
  assert.match(intro, /mcp\/src\/core\.js/);
});

const page = renderDocsHtml();

test("/docs and /docs/raw come from the same source", () => {
  assert.ok(!existsSync(new URL("../src/components/DocsContent.tsx", import.meta.url)), "the hand-written JSX copy is gone");
  assert.match(read("src/pages/docs/raw.ts"), /import \{ DOCS_MARKDOWN \} from "..\/..\/..\/lib\/docs-content"/);
  const astro = read("src/pages/docs/index.astro");
  assert.match(astro, /import \{ renderDocsHtml \} from "..\/..\/..\/lib\/docs-content"/);
  assert.match(astro, /set:html=\{renderDocsHtml\(\)\}/);
});

test("the rendered /docs page lists every API endpoint", () => {
  const endpoints = [
    "POST /api/documents",
    "GET /api/d/:id?key=KEY", "PUT /api/d/:id?key=KEY", "PATCH /api/d/:id?key=KEY", "DELETE /api/d/:id?key=KEY",
    "PUT /api/d/:id/expiry?key=KEY",
    "POST /api/d/:id/links?key=KEY", "GET /api/d/:id/links?key=KEY",
    "PATCH /api/links/:id?key=KEY", "DELETE /api/links/:id?key=KEY",
    "POST /api/d/:id/comments?key=KEY", "GET /api/d/:id/comments?key=KEY", "PATCH /api/comments/:id?key=KEY",
    "GET /api/d/:id/versions?key=KEY",
    "POST /api/d/:id/presence?key=KEY", "GET /api/d/:id/presence?key=KEY",
  ];
  const rows = [...page.matchAll(/<td><code>(GET|POST|PUT|PATCH|DELETE)<\/code><\/td>\s*<td><code>([^<]+)<\/code>/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(rows.sort(), [...endpoints].sort());
});

test("every /docs#anchor linked from the site and the README exists on the page", () => {
  const files = ["src", "public"].flatMap((dir) =>
    (readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true }) as string[]).map((f) => `${dir}/${f}`),
  ).filter((f) => /\.(astro|tsx?|md|txt|html)$/.test(f));
  const anchors = new Set(["use-with-ai", "vscode", "obsidian"]);
  for (const f of ["README.md", ...files]) for (const m of read(f).matchAll(/\/docs#([\w-]+)/g)) anchors.add(m[1]);
  for (const a of anchors) assert.match(page, new RegExp(`<h2 id="${a}">`), `#${a}`);
});

test("/docs/raw carries the sections that used to be on the HTML page only", () => {
  for (const heading of ["## Use with AI", "### What to tell your AI", "### Without MCP", "## VS Code extension", "## Obsidian plugin"]) {
    assert.ok(DOCS_MARKDOWN.includes(`\n${heading}`), heading);
  }
  for (const config of ["claude_desktop_config.json", "~/.codex/config.json", "~/.gemini/settings.json", "~/.cursor/mcp.json", "~/.codeium/windsurf/mcp_config.json"]) {
    assert.ok(DOCS_MARKDOWN.includes(config), config);
  }
});

test("the docs cover expiry, conflicts, link ids, X-Author encoding and every error code", () => {
  for (const re of [/\/api\/d\/:id\/expiry/, /90 days/, /mdshare\.live\/mcp/, /mdshare-mcp upload/, /X-Base-Hash/, /encodeURIComponent/, /"expires_at": "/, /`content_hash`, `permission`/, /Malformed JSON/i]) {
    assert.match(DOCS_MARKDOWN, re);
  }
  const codes = [...DOCS_MARKDOWN.matchAll(/^\| `([45]\d\d)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(codes, ["400", "403", "404", "409", "410", "429"]);
});

test("the rendered /docs page ships no script and highlights code", () => {
  assert.doesNotMatch(page, /<script/i);
  assert.match(page, /<pre><code class="language-bash">[^]*?<span class="hljs-string">/);
});
