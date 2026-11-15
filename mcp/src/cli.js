// The command line: the same tools as the MCP server (core.js), for scripts, CI and shells.
// Results go to stdout, messages to stderr. Exit codes: 0 ok, 1 failure, 2 bad usage.
// Admin keys come from the local store and are never printed, except by `admin-url`.

import { readFile, writeFile } from "node:fs/promises";
import { VERSION, setClient, handleTool, readDoc, readStore, parseDocLink } from "./core.js";

const HELP = `mdshare-mcp ${VERSION}: share markdown from the command line, or run as an MCP server.

  mdshare-mcp upload <file|-> [--permission view|comment|edit] [--title T] [--expires 7d]
                                         print a share link (comment by default); the admin key is stored, not shown
  mdshare-mcp update <doc-id> <file|->   replace the content; refuses if someone changed it since your
                     [--base-hash H] [--force]   last upload, update or read here
  mdshare-mcp read <doc-id|link> [-o out.md]
  mdshare-mcp ls                         your stored documents
  mdshare-mcp link <doc-id> --view|--comment|--edit [--expires 30d]
  mdshare-mcp links <doc-id>
  mdshare-mcp revoke <doc-id> <link-token>
  mdshare-mcp expire <doc-id> <30d|12h>  at most 365d ahead
  mdshare-mcp comments <doc-id>
  mdshare-mcp comment <doc-id> "text" [--author NAME (or MDSHARE_AUTHOR)] [--anchor "quoted text"]
  mdshare-mcp resolve <doc-id> <comment-id> [--reopen]
  mdshare-mcp versions <doc-id>
  mdshare-mcp admin-url <doc-id>         the only command that prints an admin URL
  mdshare-mcp serve                      the MCP server (also: no arguments, as MCP clients start it)

  --json prints results as JSON. "-" reads stdin: pandoc doc.docx -t gfm | mdshare-mcp upload -
  Keys live in ~/.mdshare-mcp/documents.json (mode 0600). Tip: alias mdshare='npx -y mdshare-mcp'`;

const DEFAULT_IO = {
  stdin: async () => {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString("utf-8");
  },
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
};

class Usage extends Error {}

function printJson(io, value) {
  io.out(JSON.stringify(value, null, 2) + "\n");
  return 0;
}

const UNITS = { h: 3600_000, d: 86400_000 };
/** "12h" or "7d" in milliseconds; null for anything else. */
export function parseDuration(s) {
  const m = /^(\d+)([hd])$/.exec(String(s));
  return m ? Number(m[1]) * UNITS[m[2]] : null;
}

function isoAfter(s) {
  const ms = parseDuration(s);
  if (ms === null) {
    throw new Usage(s === "never"
      ? "mdshare keeps a document at most a year ahead: use a duration up to 365d"
      : `not a duration: ${s} (use 12h, 7d, 365d)`);
  }
  return new Date(Date.now() + ms).toISOString();
}

const SWITCHES = ["--json", "--force", "--view", "--comment", "--edit", "--reopen"];

/** Split argv into positionals and flags: flags in `takes` read a value (`--x v` or `--x=v`),
 *  the switches are true when present, anything else is bad usage. */
function parse(argv, takes) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-" || !a.startsWith("-")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const [name, inline] = eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, undefined];
    if (takes.includes(name)) {
      if (inline === undefined && i + 1 >= argv.length) throw new Usage(`${name} needs a value`);
      flags[name] = inline ?? argv[++i];
    } else if (SWITCHES.includes(a)) flags[a] = true;
    else throw new Usage(`unknown option: ${name}`);
  }
  return { pos, flags };
}

function need(pos, n, usage) {
  if (pos.length < n) throw new Usage(`usage: mdshare-mcp ${usage}`);
  return pos;
}

/** Markdown from a file path or "-" for stdin. */
async function content(source, io) {
  const text = source === "-" ? await io.stdin() : await readFile(source, "utf-8");
  if (!text.trim()) throw new Usage(`${source === "-" ? "stdin" : source} is empty`);
  return text;
}

/** A tool's JSON answer; an { error } from the server is a failure. */
async function tool(name, args) {
  const data = JSON.parse(await handleTool(name, args));
  if (data && data.error && data.error !== "conflict") throw new Error(data.message || data.error);
  return data;
}

const COMMANDS = {
  async upload(argv, io) {
    const { pos, flags } = parse(argv, ["--permission", "--title", "--expires"]);
    const [src] = need(pos, 1, "upload <file|-> [--permission view|comment|edit] [--title T] [--expires 7d]");
    const expires = flags["--expires"] ? isoAfter(flags["--expires"]) : null;
    const text = await content(src, io);
    const r = await tool("upload_markdown", {
      content: text,
      share_permission: flags["--permission"] || "comment",
      title: flags["--title"],
      remember_version: true,
    });
    if (r.admin_url_to_save_manually) {
      io.err(`${r.error}\n${r.admin_url_to_save_manually}\n`);
      return 1;
    }
    // the document exists now: a failed expiry is reported, but the link is still printed
    let code = 0;
    if (expires) {
      try {
        r.expires_at = (await tool("set_expiry", { document_id: r.document_id, expires_at: expires })).expires_at || expires;
      } catch (e) {
        io.err(`uploaded, but the expiry was not set: ${e.message}\n`);
        code = 1;
      }
    }
    if (flags["--json"]) printJson(io, r);
    else {
      if (r.warning) io.err(`${r.warning}\n`);
      io.out(`${r.share_url ?? ""}\n`);
      io.err(`${r.document_id}: ${r.title}, ${r.share_permission ?? "no"} link, expires ${r.expires_at}\n`);
    }
    return code;
  },

  async update(argv, io) {
    const { pos, flags } = parse(argv, ["--base-hash", "--author"]);
    const [id, src] = need(pos, 2, "update <doc-id> <file|-> [--base-hash H] [--force]");
    const stored = (await readStore()).find((d) => d.id === id);
    const base = flags["--force"] ? undefined : flags["--base-hash"] || stored?.content_hash;
    if (!base && !flags["--force"]) io.err("no version recorded for this document here: writing without a conflict check\n");
    const r = await tool("update_document", { document_id: id, content: await content(src, io), base_hash: base, author: flags["--author"] });
    if (r.error === "conflict") {
      io.err(`${id} changed since your last upload, update or read here. Nothing was written.\n` +
        `Read it (mdshare-mcp read ${id} -o current.md), merge your changes, and update again.\n`);
      return 1;
    }
    if (flags["--json"]) return printJson(io, r);
    io.err(`${id}: ${r.status}${r.content_hash ? `, version ${r.content_hash.slice(0, 12)}` : ""}\n`);
  },

  async read(argv, io) {
    const { pos, flags } = parse(argv, ["-o"]);
    const [target] = need(pos, 1, "read <doc-id|link> [-o out.md]");
    const link = parseDocLink(target);
    const { content: text, contentHash } = await readDoc(link ? link.documentId : target, link?.key);
    if (flags["-o"]) {
      await writeFile(flags["-o"], text, "utf-8");
      io.err(`saved ${Buffer.byteLength(text)} bytes to ${flags["-o"]}\n`);
    } else if (flags["--json"]) printJson(io, { content: text, content_hash: contentHash });
    else io.out(text);
  },

  async ls(argv, io) {
    const r = await tool("list_my_documents", {});
    if (parse(argv, []).flags["--json"]) return printJson(io, r);
    if (!r.documents.length) {
      io.err("no documents stored here yet\n");
      return 0;
    }
    for (const d of r.documents) io.out(`${d.id}  ${d.title}  ${d.share_url ?? "-"}  expires ${d.expires_at ?? "?"}\n`);
  },

  async link(argv, io) {
    const { pos, flags } = parse(argv, ["--expires", "--label"]);
    const [id] = need(pos, 1, "link <doc-id> --view|--comment|--edit [--expires 30d]");
    const permission = ["view", "comment", "edit"].find((p) => flags[`--${p}`]);
    if (!permission) throw new Usage("say which link: --view, --comment or --edit");
    const r = await tool("generate_link", { document_id: id, permission, label: flags["--label"] || "cli",
      expires_at: flags["--expires"] ? isoAfter(flags["--expires"]) : undefined });
    if (flags["--json"]) return printJson(io, r);
    io.out(`${r.url}\n`);
  },

  async links(argv, io) {
    const [id] = need(parse(argv, []).pos, 1, "links <doc-id>");
    printJson(io, await tool("list_links", { document_id: id }));
  },

  async revoke(argv, io) {
    const [id, token] = need(parse(argv, []).pos, 2, "revoke <doc-id> <link-token>");
    await tool("revoke_link", { document_id: id, link_token: token });
    io.err(`revoked ${token}\n`);
  },

  async expire(argv, io) {
    const { pos, flags } = parse(argv, []);
    const [id, when] = need(pos, 2, "expire <doc-id> <30d|12h>");
    const r = await tool("set_expiry", { document_id: id, expires_at: isoAfter(when) });
    if (flags["--json"]) return printJson(io, r);
    io.err(`${id} expires ${r.expires_at}\n`);
  },

  async comments(argv, io) {
    const { pos, flags } = parse(argv, []);
    const [id] = need(pos, 1, "comments <doc-id>");
    const r = await tool("list_comments", { document_id: id });
    if (flags["--json"]) return printJson(io, r);
    for (const c of r.comments ?? []) {
      io.out(`${c.id}  ${c.resolved ? "[resolved] " : ""}${c.author_name ?? "?"}: ${c.content}\n`);
    }
  },

  async comment(argv, io) {
    const { pos, flags } = parse(argv, ["--author", "--anchor", "--reply-to"]);
    const [id, text] = need(pos, 2, 'comment <doc-id> "text" [--author NAME] [--anchor "quoted text"]');
    const r = await tool("post_comment", { document_id: id, content: text,
      author_name: flags["--author"] || process.env.MDSHARE_AUTHOR || "mdshare CLI",
      anchor_text: flags["--anchor"], parent_id: flags["--reply-to"] });
    if (flags["--json"]) return printJson(io, r);
    io.err(`commented ${r.id ?? ""}\n`);
  },

  async resolve(argv, io) {
    const { pos, flags } = parse(argv, []);
    const [id, commentId] = need(pos, 2, "resolve <doc-id> <comment-id> [--reopen]");
    // resolve_comment takes the key itself: look it up here so it never goes on the command line
    const doc = (await readStore()).find((d) => d.id === id);
    if (!doc) throw new Error(`No admin key found for document ${id}.`);
    await tool("resolve_comment", { comment_id: commentId, key: doc.admin_key, resolved: !flags["--reopen"] });
    io.err(`${flags["--reopen"] ? "reopened" : "resolved"} ${commentId}\n`);
  },

  async versions(argv, io) {
    const [id] = need(parse(argv, []).pos, 1, "versions <doc-id>");
    printJson(io, await tool("get_versions", { document_id: id }));
  },

  async "admin-url"(argv, io) {
    const [id] = need(parse(argv, []).pos, 1, "admin-url <doc-id>");
    io.out(`${(await tool("get_admin_url", { document_id: id })).admin_url}\n`);
  },
};

/** Run one command; returns the exit code. */
export async function run(argv, io = DEFAULT_IO) {
  setClient("mdshare-cli");
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    io.out(HELP + "\n");
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    io.out(`mdshare-mcp ${VERSION}\n`);
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  if (!command) {
    io.err(`unknown command: ${cmd}\n\n${HELP}\n`);
    return 2;
  }
  try {
    const code = await command(rest, io);
    return typeof code === "number" ? code : 0;
  } catch (e) {
    io.err(`${e.message}\n`);
    return e instanceof Usage ? 2 : 1;
  }
}
