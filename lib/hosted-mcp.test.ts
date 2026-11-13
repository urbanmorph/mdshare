// The hosted MCP server at mdshare.live/mcp reads a document by its share link, and does nothing else.
// It never creates, stores, returns or logs a key, and it refuses admin links: the admin URL stays with
// whoever made the document (the npm package keeps it on disk). See lib/hosted-mcp.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcp, parseLink, TOOLS } from "./hosted-mcp.ts";

const ID = "Ab3_dE-9xZ";
const VIEW = `viw_${"v".repeat(32)}`;
const EDIT = `edt_${"e".repeat(32)}`;
const ADMIN = `adm_${"a".repeat(32)}`;
const link = (key: string, id = ID) => `https://mdshare.live/d/${id}?key=${key}`;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A fake of the in-process API: answers the three read routes for one document and view key. */
function fakeApi(calls: string[] = []) {
  return async (path: string): Promise<Response> => {
    calls.push(path);
    const u = new URL(path, "https://mdshare.live");
    const key = u.searchParams.get("key");
    if (![VIEW, EDIT].includes(key!) || !u.pathname.startsWith(`/api/d/${ID}`)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (u.pathname === `/api/d/${ID}`) {
      return Response.json({
        document_id: ID, title: "Notes", content: "# Notes\n\nHello", content_hash: "h1",
        permission: key === VIEW ? "view" : "edit", last_edited_by: "Asha", last_edited_via: "web",
        last_edited_at: "2026-11-12T10:00:00Z", created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-12T10:00:00Z", expires_at: "2027-01-30T00:00:00Z",
      });
    }
    if (u.pathname === `/api/d/${ID}/comments`) return Response.json({ comments: [{ id: "c1", content: "Nice", resolved: 0 }] });
    if (u.pathname === `/api/d/${ID}/versions`) return Response.json({ versions: [{ id: "v1", edited_by: "Asha" }] });
    return Response.json({ error: "Not found" }, { status: 404 });
  };
}

const deps = (over: Partial<Parameters<typeof handleMcp>[1]> = {}) => ({ readApi: fakeApi(), allow: () => true, ...over });
const post = (body: unknown, init: RequestInit = {}) =>
  new Request("https://mdshare.live/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
const rpc = async (body: unknown, d = deps()) => {
  const r = await handleMcp(post(body), d);
  return { status: r.status, json: r.status === 202 ? null : ((await r.json()) as Json) };
};
const call = (name: string, args: Json, d = deps()) =>
  rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, d);

// ----- links -----

test("parseLink: a view, comment or edit link gives the document id and its key", () => {
  assert.deepEqual(parseLink(link(VIEW)), { id: ID, key: VIEW, permission: "view" });
  assert.deepEqual(parseLink(link(EDIT)), { id: ID, key: EDIT, permission: "edit" });
  assert.deepEqual(parseLink(`https://www.mdshare.live/d/${ID}?key=cmt_${"c".repeat(32)}`), {
    id: ID, key: `cmt_${"c".repeat(32)}`, permission: "comment",
  });
});

test("parseLink: refuses an admin link, and says not to paste one into a chat", () => {
  const r = parseLink(link(ADMIN)) as { error: string };
  assert.match(r.error, /admin link/i);
  assert.match(r.error, /don.t paste/i);
  assert.ok(!r.error.includes(ADMIN), "the refusal never echoes the key");
});

test("parseLink: refuses anything that isn't an mdshare share link", () => {
  for (const bad of [
    `https://evil.example/d/${ID}?key=${VIEW}`,
    `http://mdshare.live/d/${ID}?key=${VIEW}`,
    `https://mdshare.live/d/${ID}`,
    `https://mdshare.live/x/${ID}?key=${VIEW}`,
    `https://mdshare.live/d/${ID}?key=nope_${"x".repeat(32)}`,
    "not a link",
    "",
  ]) {
    const r = parseLink(bad) as { error?: string };
    assert.ok(r.error, `refused: ${bad}`);
    assert.ok(!r.error!.includes(VIEW), "the refusal never echoes the key");
  }
});

// ----- protocol -----

test("initialize: a read-only server whose instructions say it reads by link and never takes an admin link", async () => {
  const { json } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(json.result.serverInfo.name, "mdshare");
  assert.ok(json.result.capabilities.tools);
  assert.match(json.result.instructions, /share link/i);
  assert.match(json.result.instructions, /admin/i);
  assert.match(json.result.instructions, /npx -y mdshare-mcp/);
});

test("tools/list: exactly the three read tools, read-only, each taking a link", async () => {
  const { json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(json.result.tools.map((t: Json) => t.name), ["read_document", "list_comments", "get_versions"]);
  for (const t of json.result.tools) {
    assert.deepEqual(t.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.deepEqual(t.inputSchema.required, ["link"]);
    assert.ok(t.inputSchema.properties.link.description.length > 20);
  }
  assert.equal(TOOLS.length, 3);
});

test("ping, notifications and unknown methods", async () => {
  assert.deepEqual((await rpc({ jsonrpc: "2.0", id: 3, method: "ping" })).json.result, {});
  assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 4, method: "resources/list" })).json.error.code, -32601);
});

test("bad JSON, batches and oversized bodies are refused", async () => {
  assert.equal((await rpc("{not json")).json.error.code, -32700);
  assert.equal((await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])).json.error.code, -32600);
  const big = await handleMcp(post({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(70_000) } }), deps());
  assert.equal(big.status, 413);
});

test("OPTIONS answers CORS; GET is not the protocol", async () => {
  const opt = await handleMcp(new Request("https://mdshare.live/mcp", { method: "OPTIONS" }), deps());
  assert.equal(opt.status, 204);
  assert.match(opt.headers.get("access-control-allow-methods")!, /POST/);
  const get = await handleMcp(new Request("https://mdshare.live/mcp"), deps());
  assert.equal(get.status, 405);
});

// ----- tools -----

test("read_document: the markdown and what the link allows, from the link alone", async () => {
  const calls: string[] = [];
  const { json } = await call("read_document", { link: link(VIEW) }, deps({ readApi: fakeApi(calls) }));
  const text = json.result.content[0].text;
  assert.match(text, /# Notes\n\nHello/);
  assert.match(text, /view/);
  assert.match(text, /2027-01-30/);
  assert.equal(json.result.isError, undefined);
  assert.deepEqual(calls, [`/api/d/${ID}?key=${VIEW}`]);
  assert.ok(!text.includes(VIEW), "the answer never repeats the key");
});

test("list_comments and get_versions read their routes", async () => {
  const c = await call("list_comments", { link: link(VIEW) });
  assert.match(c.json.result.content[0].text, /Nice/);
  const v = await call("get_versions", { link: link(EDIT) });
  assert.match(v.json.result.content[0].text, /Asha/);
});

test("an edit link is only ever used to read", async () => {
  const calls: string[] = [];
  await call("read_document", { link: link(EDIT) }, deps({ readApi: fakeApi(calls) }));
  assert.deepEqual(calls, [`/api/d/${ID}?key=${EDIT}`]);
});

test("an admin link is refused before any read", async () => {
  const calls: string[] = [];
  const { json } = await call("read_document", { link: link(ADMIN) }, deps({ readApi: fakeApi(calls) }));
  assert.equal(json.result.isError, true);
  assert.match(json.result.content[0].text, /admin link/i);
  assert.deepEqual(calls, []);
});

test("a link that doesn't open a document says so, without the key", async () => {
  const other = `viw_${"z".repeat(32)}`;
  const { json } = await call("read_document", { link: link(other) });
  assert.equal(json.result.isError, true);
  assert.match(json.result.content[0].text, /not found|expired|revoked/i);
  assert.ok(!json.result.content[0].text.includes(other));
});

test("unknown tools and missing links are invalid params", async () => {
  assert.equal((await call("upload_markdown", { content: "x" })).json.error.code, -32602);
  assert.equal((await call("read_document", {})).json.error.code, -32602);
});

test("over the rate limit, a tool call is refused and nothing is read", async () => {
  const calls: string[] = [];
  const { json } = await call("read_document", { link: link(VIEW) }, deps({ readApi: fakeApi(calls), allow: () => false }));
  assert.equal(json.result.isError, true);
  assert.match(json.result.content[0].text, /too many/i);
  assert.deepEqual(calls, []);
});

test("nothing the server logs ever carries a key", async () => {
  const logged: string[] = [];
  const orig = { warn: console.warn, error: console.error };
  const capture = (...a: unknown[]) => { logged.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  console.warn = capture;
  console.error = capture;
  try {
    const boom = async () => { throw new Error(`upstream failed for /api/d/${ID}?key=${VIEW}`); };
    const { json } = await call("read_document", { link: link(VIEW) }, deps({ readApi: boom }));
    assert.equal(json.result.isError, true);
    assert.ok(!json.result.content[0].text.includes(VIEW));
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(logged.every((l) => !l.includes(VIEW)), "no key in any log line");
});
