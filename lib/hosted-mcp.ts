// The hosted MCP server at mdshare.live/mcp: read a document by its share link, nothing else.
//
// It keeps mdshare's promise ("the admin URL stays on disk"; "links are keys"):
// - it never creates, stores or returns a key: uploading, editing, links and expiry stay in the npm
//   package (npx -y mdshare-mcp), which keeps admin keys on the user's machine;
// - it refuses admin links, and uses any other link only to read;
// - it never logs a key: arguments are not logged, and errors are reported without their message.
//
// Stateless JSON-RPC 2.0 over Streamable HTTP (2025-06-18), JSON responses, as on mugilu.live and
// bharatlas.com. The reads go through `readApi`, the site's own API called in-process (src/worker.ts),
// so the access checks (token, document, expiry) are the API's own.

export type Permission = "view" | "comment" | "edit";
export type Link = { id: string; key: string; permission: Permission };
export type Deps = {
  /** GET a path of the mdshare API (e.g. /api/d/<id>?key=<key>) in-process. */
  readApi: (path: string) => Promise<Response>;
  /** False when the caller is over the rate limit. */
  allow: () => boolean;
};

const PROTOCOL = "2025-06-18";
const PROTOCOLS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
const MAX_BODY = 64 * 1024;
const HOSTS = new Set(["mdshare.live", "www.mdshare.live"]);
const PREFIXES: Record<string, Permission | "admin"> = { viw_: "view", cmt_: "comment", edt_: "edit", adm_: "admin" };
const ID = /^[A-Za-z0-9_-]{6,32}$/;
const KEY = /^(viw|cmt|edt|adm)_[A-Za-z0-9_-]{16,64}$/;

const ADMIN_REFUSED =
  "That is an admin link. This hosted server never takes admin links: don't paste them into a chat. " +
  "Share a view, comment or edit link instead (the admin page can make one), or manage the document with the " +
  "mdshare npm package (npx -y mdshare-mcp), which keeps admin links on your own machine.";

export const INSTRUCTIONS = `mdshare (hosted, read only). mdshare.live is free markdown sharing with no login: a document is shared by links, and each link carries its permission (view, comment, edit or admin).

This hosted server reads a document from a share link someone gave you: pass the whole link (https://mdshare.live/d/<id>?key=...) as "link".
- read_document: the markdown, its title, what the link allows, when it was last edited and when it expires.
- list_comments: the comments and replies, and whether each is resolved.
- get_versions: who edited it, when, and how.

It never takes admin links (keys starting adm_): an admin link controls the document, so don't paste one into a chat. Links are used only to read; nothing is stored.

To upload, edit, comment, make or revoke links, or set expiry, install the mdshare MCP server: npx -y mdshare-mcp. It keeps admin links on your own machine.`;

const SERVER_INFO = { name: "mdshare", title: "mdshare: read a shared markdown document", version: "1.6.0" };

const linkProp = {
  type: "string",
  description: "The mdshare share link you were given, in full: https://mdshare.live/d/<id>?key=... (a view, comment or edit link; admin links are refused).",
};
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const tool = (name: string, title: string, description: string) => ({
  name, title, description, annotations: READ,
  inputSchema: { type: "object", properties: { link: linkProp }, required: ["link"], additionalProperties: false },
});

export const TOOLS = [
  tool("read_document", "Read a shared document",
    "Read an mdshare document from its share link: the markdown, its title, what the link allows (view, comment or edit), the last edit and when it expires."),
  tool("list_comments", "List a document's comments",
    "List the comments on an mdshare document from its share link: each comment's author, text, the passage it is anchored to, its replies and whether it is resolved."),
  tool("get_versions", "Get a document's edit history",
    "Get the edit history of an mdshare document from its share link: who edited it, when, and how (web, API or an integration)."),
];

/** The document id, key and permission in an mdshare share link, or why it can't be used. */
export function parseLink(link: string): Link | { error: string } {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return { error: "That isn't a link. Pass the whole mdshare share link: https://mdshare.live/d/<id>?key=..." };
  }
  const [, d, id, extra] = u.pathname.split("/");
  const key = u.searchParams.get("key") ?? "";
  if (u.protocol !== "https:" || !HOSTS.has(u.hostname) || d !== "d" || !id || extra !== undefined || !ID.test(id)) {
    return { error: "That isn't an mdshare share link. It should look like https://mdshare.live/d/<id>?key=..." };
  }
  if (!KEY.test(key)) return { error: "That link has no valid key. Copy the whole share link, including ?key=..." };
  const permission = PREFIXES[key.slice(0, 4)];
  if (permission === "admin") return { error: ADMIN_REFUSED };
  return { id, key, permission };
}

const ROUTES: Record<string, (l: Link) => string> = {
  read_document: (l) => `/api/d/${l.id}?key=${l.key}`,
  list_comments: (l) => `/api/d/${l.id}/comments?key=${l.key}`,
  get_versions: (l) => `/api/d/${l.id}/versions?key=${l.key}`,
};

type Doc = {
  title?: string; content?: string; content_hash?: string; permission?: string; last_edited_by?: string | null;
  last_edited_via?: string | null; last_edited_at?: string | null; expires_at?: string | null;
};

function documentText(d: Doc): string {
  const edited = d.last_edited_at
    ? `${d.last_edited_at}${d.last_edited_by ? ` by ${d.last_edited_by}` : ""}${d.last_edited_via ? ` (${d.last_edited_via})` : ""}`
    : "not since it was uploaded";
  return [
    `Title: ${d.title ?? "(untitled)"}`,
    `This link allows: ${d.permission ?? "view"}`,
    `Last edited: ${edited}`,
    `Expires: ${d.expires_at ?? "never set"}`,
    `content_hash: ${d.content_hash ?? ""}`,
    "",
    "---",
    "",
    d.content ?? "",
  ].join("\n");
}

const toolError = (text: string) => ({ content: [{ type: "text", text }], isError: true });

async function callTool(name: string, args: Record<string, unknown>, deps: Deps) {
  const parsed = parseLink(String(args.link));
  if ("error" in parsed) return toolError(parsed.error);
  if (!deps.allow()) return toolError("Too many requests from you just now. Wait a minute and try again.");
  let r: Response;
  try {
    r = await deps.readApi(ROUTES[name](parsed));
  } catch (err) {
    // the message could carry the key (it names the path): log only what kind of error it was
    console.error("hosted MCP: read failed", { tool: name, error: err instanceof Error ? err.name : typeof err });
    return toolError("mdshare couldn't read the document just now. Try again in a moment.");
  }
  if (r.status === 404) {
    return toolError("That link doesn't open a document: it may be mistyped, revoked, or the document has expired or been deleted.");
  }
  if (r.status === 410) return toolError("That document has expired and been deleted.");
  if (!r.ok) return toolError(`mdshare answered ${r.status}. Try again in a moment.`);
  const data = (await r.json()) as Doc;
  const text = name === "read_document" ? documentText(data) : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id",
  "access-control-max-age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
const ok = (id: unknown, result: unknown) => json({ jsonrpc: "2.0", id, result });
const fail = (id: unknown, code: number, message: string, status = 200) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);

export async function handleMcp(request: Request, deps: Deps): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") {
    return new Response("mdshare's MCP endpoint speaks JSON-RPC over POST. See https://mdshare.live/docs", {
      status: 405, headers: { allow: "POST, OPTIONS", "content-type": "text/plain; charset=utf-8", ...CORS },
    });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return fail(null, -32600, "Request too large", 413);
  const text = await request.text();
  if (text.length > MAX_BODY) return fail(null, -32600, "Request too large", 413);

  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(text);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  if (Array.isArray(msg) || !msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return fail(null, -32600, "Invalid request (batches are not supported)");
  }
  const { id, method, params = {} } = msg;
  if (id === undefined) return new Response(null, { status: 202, headers: CORS }); // a notification

  switch (method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return ok(id, {
        protocolVersion: PROTOCOLS.has(asked) ? asked : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (!(name in ROUTES)) return fail(id, -32602, `Unknown tool: ${name}. This hosted server only reads (read_document, list_comments, get_versions); for the rest, use npx -y mdshare-mcp.`);
      if (typeof args.link !== "string" || !args.link) return fail(id, -32602, "Missing argument: link (the mdshare share link)");
      return ok(id, await callTool(name, args, deps));
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
