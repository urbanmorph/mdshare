import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, parseDuration } from "../src/cli.js";
import { VERSION } from "../src/core.js";

const BASE = "https://mdshare.live";
const ADMIN = "adm_secretAdminKey123";
let calls, routes, home;

// A fake mdshare: each route is [method, path regex, handler(request) -> [status, body]].
function fakeFetch(url, init = {}) {
  const u = new URL(url);
  const method = init.method || "GET";
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const call = { method, path: u.pathname, query: u.searchParams, headers, body: init.body };
  calls.push(call);
  const route = routes.find(([m, re]) => m === method && re.test(u.pathname));
  if (!route) return Promise.resolve(new Response(JSON.stringify({ error: "Not found" }), { status: 404 }));
  const [status, body] = route[2](call);
  return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

function io(stdinText = "") {
  const out = [], err = [];
  return {
    io: { stdin: async () => stdinText, out: (s) => out.push(s), err: (s) => err.push(s), isTTY: false },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

const created = () => [201, { document_id: "doc1", admin_key: ADMIN, admin_url: `${BASE}/d/doc1?key=${ADMIN}`, expires_at: "2027-02-13T00:00:00.000Z" }];
const uploadRoutes = () => [
  ["POST", /^\/api\/documents$/, created],
  ["POST", /^\/api\/d\/doc1\/links$/, (c) => [201, { url: `${BASE}/d/doc1?key=${JSON.parse(c.body).permission.slice(0, 3)}_share1` }]],
  ["GET", /^\/api\/d\/doc1$/, (c) => (c.headers.accept === "application/json" ? [200, { content_hash: "hash1" }] : [200, "# Notes\n"])],
];

async function store() {
  return JSON.parse(await readFile(join(home, ".mdshare-mcp", "documents.json"), "utf-8"));
}

beforeEach(async () => {
  calls = [];
  routes = [];
  home = await mkdtemp(join(tmpdir(), "mdshare-cli-"));
  process.env.HOME = home;
  delete process.env.MDSHARE_URL;
  globalThis.fetch = fakeFetch;
});

test("no command prints help and exits 0; an unknown command is bad usage (2)", async () => {
  const a = io();
  assert.equal(await run([], a.io), 0);
  assert.match(a.out(), /mdshare-mcp upload/);
  const b = io();
  assert.equal(await run(["frobnicate"], b.io), 2);
  assert.match(b.err(), /unknown command/i);
});

test("--version prints the version", async () => {
  const a = io();
  assert.equal(await run(["--version"], a.io), 0);
  assert.equal(a.out().trim(), `mdshare-mcp ${VERSION}`);
});

test("upload - reads stdin, prints only the share link, and keeps the admin key in the store", async () => {
  routes = uploadRoutes();
  const a = io("# Notes\nhello\n");
  assert.equal(await run(["upload", "-"], a.io), 0);
  assert.equal(a.out().trim(), `${BASE}/d/doc1?key=com_share1`);
  assert.doesNotMatch(a.out() + a.err(), /adm_/);
  const create = calls.find((c) => c.path === "/api/documents");
  assert.equal(create.body, "# Notes\nhello\n");
  assert.equal(create.headers["user-agent"], `mdshare-cli/${VERSION}`);
  const [doc] = await store();
  assert.equal(doc.id, "doc1");
  assert.equal(doc.admin_key, ADMIN);
  assert.equal(doc.content_hash, "hash1", "the stored version is the base for the next update");
});

test("upload a file with --permission, --title and --expires", async () => {
  routes = [...uploadRoutes(), ["PUT", /^\/api\/d\/doc1\/expiry$/, (c) => [200, { expires_at: JSON.parse(c.body).expires_at }]]];
  const file = join(home, "plan.md");
  await writeFile(file, "no heading here\n");
  const a = io();
  assert.equal(await run(["upload", file, "--permission", "view", "--title", "Plan für Q1", "--expires", "7d"], a.io), 0);
  assert.equal(a.out().trim(), `${BASE}/d/doc1?key=vie_share1`);
  const create = calls.find((c) => c.path === "/api/documents");
  assert.equal(create.headers["x-title"], encodeURIComponent("Plan für Q1"));
  const expiry = JSON.parse(calls.find((c) => c.path.endsWith("/expiry")).body).expires_at;
  const days = (new Date(expiry) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days < 7.1, `expiry ${days} days out`);  const [doc] = await store();
  assert.equal(doc.title, "Plan für Q1", "the stored title is the one given");
  assert.equal(doc.expires_at, expiry, "the stored expiry follows --expires");
});

test("upload --json prints the result as JSON, without the admin key", async () => {
  routes = uploadRoutes();
  const a = io("# Notes\n");
  assert.equal(await run(["upload", "-", "--json"], a.io), 0);
  const r = JSON.parse(a.out());
  assert.equal(r.document_id, "doc1");
  assert.equal(r.share_url, `${BASE}/d/doc1?key=com_share1`);
  assert.doesNotMatch(a.out(), /adm_/);
});

test("upload with empty stdin is bad usage", async () => {
  const a = io("   \n");
  assert.equal(await run(["upload", "-"], a.io), 2);
  assert.match(a.err(), /empty/i);
  assert.equal(calls.length, 0);
});

async function seed() {
  routes = uploadRoutes();
  await run(["upload", "-"], io("# Notes\n").io);
  calls = [];
}

test("update sends the stored version as the base and stores the new one", async () => {
  await seed();
  routes = [["PUT", /^\/api\/d\/doc1$/, () => [200, { status: "updated", content_hash: "hash2" }]]];
  const a = io("# Notes\nmore\n");
  assert.equal(await run(["update", "doc1", "-"], a.io), 0);
  const put = calls[0];
  assert.equal(put.headers["x-base-hash"], "hash1");
  assert.equal(put.query.get("key"), ADMIN);
  assert.equal(put.body, "# Notes\nmore\n");
  assert.equal((await store())[0].content_hash, "hash2");
  assert.match(a.err(), /updated/);
});

test("update refuses on conflict: exit 1, nothing stored changes", async () => {
  await seed();
  routes = [["PUT", /^\/api\/d\/doc1$/, () => [409, { error: "conflict", content_hash: "theirs" }]]];
  const a = io("# Mine\n");
  assert.equal(await run(["update", "doc1", "-"], a.io), 1);
  assert.match(a.err(), /changed since/i);
  assert.equal((await store())[0].content_hash, "hash1");
});

test("update --force and --base-hash override the stored version", async () => {
  await seed();
  routes = [["PUT", /^\/api\/d\/doc1$/, () => [200, { status: "updated", content_hash: "h" }]]];
  await run(["update", "doc1", "-", "--force"], io("x").io);
  assert.equal(calls[0].headers["x-base-hash"], undefined);
  await run(["update", "doc1", "-", "--base-hash", "given"], io("y").io);
  assert.equal(calls[1].headers["x-base-hash"], "given");
});

test("read prints the document, or writes it with -o; reading records the version seen", async () => {
  await seed();
  routes = [["GET", /^\/api\/d\/doc1$/, (c) => (c.headers.accept === "application/json" ? [200, { content_hash: "seen" }] : [200, "# Notes\nnow\n"])]];
  const a = io();
  assert.equal(await run(["read", "doc1"], a.io), 0);
  assert.equal(a.out(), "# Notes\nnow\n");
  const file = join(home, "out.md");
  const b = io();
  assert.equal(await run(["read", "doc1", "-o", file], b.io), 0);
  assert.equal(await readFile(file, "utf-8"), "# Notes\nnow\n");
  assert.equal(b.out(), "");
  // the hash of what was read, so a later update is based on it
  const { createHash } = await import("node:crypto");
  assert.equal((await store())[0].content_hash, createHash("sha256").update("# Notes\nnow\n").digest("hex"));
});

test("read a share link someone sent, without anything stored", async () => {
  routes = [["GET", /^\/api\/d\/abc$/, (c) => [200, `read with ${c.query.get("key")}`]]];
  const a = io();
  assert.equal(await run(["read", `${BASE}/d/abc?key=vie_xyz`], a.io), 0);
  assert.equal(a.out(), "read with vie_xyz");
});

test("an unknown document id fails with a hint (exit 1)", async () => {
  const a = io();
  assert.equal(await run(["read", "nope"], a.io), 1);
  assert.match(a.err(), /No admin key found/);
});

test("ls lists stored documents without their admin keys", async () => {
  await seed();
  const a = io();
  assert.equal(await run(["ls"], a.io), 0);
  assert.match(a.out(), /doc1/);
  assert.match(a.out(), /Notes/);
  assert.doesNotMatch(a.out(), /adm_/);
  const b = io();
  await run(["ls", "--json"], b.io);
  assert.equal(JSON.parse(b.out()).documents[0].id, "doc1");
  assert.doesNotMatch(b.out(), /adm_/);
});

test("admin-url is the one command that prints the admin URL", async () => {
  await seed();
  const a = io();
  assert.equal(await run(["admin-url", "doc1"], a.io), 0);
  assert.equal(a.out().trim(), `${BASE}/d/doc1?key=${ADMIN}`);
});

test("link makes a share link with a permission and optional expiry", async () => {
  await seed();
  routes = [["POST", /^\/api\/d\/doc1\/links$/, (c) => [201, { url: `${BASE}/d/doc1?key=edi_new`, ...JSON.parse(c.body) }]]];
  const a = io();
  assert.equal(await run(["link", "doc1", "--edit", "--expires", "30d"], a.io), 0);
  assert.equal(a.out().trim(), `${BASE}/d/doc1?key=edi_new`);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.permission, "edit");
  const days = (new Date(body.expires_at) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days < 30.1);
  const b = io();
  assert.equal(await run(["link", "doc1"], b.io), 2, "a permission is required");
});

test("expire moves the document's expiry; 'never' is refused with the server's limit", async () => {
  await seed();
  routes = [["PUT", /^\/api\/d\/doc1\/expiry$/, (c) => [200, JSON.parse(c.body)]]];
  assert.equal(await run(["expire", "doc1", "30d"], io().io), 0);
  assert.equal((await store())[0].expires_at, JSON.parse(calls[0].body).expires_at);
  const a = io();
  assert.equal(await run(["expire", "doc1", "never"], a.io), 2);
  assert.match(a.err(), /365d/);
});

test("comment, comments, resolve and versions use the stored key", async () => {
  await seed();
  routes = [
    ["POST", /^\/api\/d\/doc1\/comments$/, (c) => [201, { id: "c1", ...JSON.parse(c.body) }]],
    ["GET", /^\/api\/d\/doc1\/comments$/, () => [200, { comments: [{ id: "c1", author_name: "Ana", content: "Looks good", resolved: 0 }] }]],
    ["PATCH", /^\/api\/comments\/c1$/, (c) => [200, { id: "c1", resolved: JSON.parse(c.body).resolved }]],
    ["GET", /^\/api\/d\/doc1\/versions$/, () => [200, { versions: [{ id: "v1", edited_by: "Ana", created_at: "2026-11-15" }] }]],
  ];
  assert.equal(await run(["comment", "doc1", "Please check section 2", "--author", "Sathya"], io().io), 0);
  assert.equal(JSON.parse(calls[0].body).author_name, "Sathya");
  const a = io();
  assert.equal(await run(["comments", "doc1"], a.io), 0);
  assert.match(a.out(), /Ana/);
  assert.equal(await run(["resolve", "doc1", "c1"], io().io), 0);
  assert.equal(calls.at(-1).query.get("key"), ADMIN);
  assert.equal(JSON.parse(calls.at(-1).body).resolved, true);
  const v = io();
  assert.equal(await run(["versions", "doc1"], v.io), 0);
  assert.match(v.out(), /v1/);
});

test("an HTTP error from the server is a failure (1) with its message", async () => {
  routes = [["POST", /^\/api\/documents$/, () => [429, { error: "Daily document creation limit reached (50 per day)." }]]];
  const a = io("# x\n");
  assert.equal(await run(["upload", "-"], a.io), 1);
  assert.match(a.err(), /50 per day/);
});

test("parseDuration reads hours and days and refuses anything else", () => {
  assert.equal(parseDuration("12h"), 12 * 3600_000);
  assert.equal(parseDuration("7d"), 7 * 86400_000);
  assert.equal(parseDuration("never"), null);
  assert.equal(parseDuration("7"), null);
});

test("the store file stays private (0600)", async () => {
  await seed();
  const mode = (await stat(join(home, ".mdshare-mcp", "documents.json"))).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("an unknown flag is bad usage; --flag=value works like --flag value", async () => {
  routes = uploadRoutes();
  const a = io("# x\n");
  assert.equal(await run(["upload", "-", "--titel", "typo"], a.io), 2);
  assert.match(a.err(), /unknown option: --titel/);
  assert.equal(calls.length, 0);
  assert.equal(await run(["upload", "-", "--permission=view"], io("# x\n").io), 0);
  assert.equal(JSON.parse(calls.find((c) => c.path.endsWith("/links")).body).permission, "view");
});

test("if setting the expiry fails after an upload, the link is still printed and the exit is 1", async () => {
  routes = [...uploadRoutes(), ["PUT", /^\/api\/d\/doc1\/expiry$/, () => [400, { error: "expires_at cannot be more than 1 year from now" }]]];
  const a = io("# x\n");
  assert.equal(await run(["upload", "-", "--expires", "400d"], a.io), 1);
  assert.equal(a.out().trim(), `${BASE}/d/doc1?key=com_share1`);
  assert.match(a.err(), /1 year/);
});

test("a comment from the CLI is not signed 'AI Assistant'", async () => {
  await seed();
  routes = [["POST", /^\/api\/d\/doc1\/comments$/, (c) => [201, { id: "c1", ...JSON.parse(c.body) }]]];
  await run(["comment", "doc1", "hi"], io().io);
  assert.notEqual(JSON.parse(calls[0].body).author_name, "AI Assistant");
});
