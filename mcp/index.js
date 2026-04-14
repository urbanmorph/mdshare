#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE_URL = "https://mdshare.live";
const STORE_DIR = join(homedir(), ".mdshare-mcp");
const STORE_PATH = join(STORE_DIR, "documents.json");

// Nudge thresholds — when the LLM passes content/operations inline above these
// sizes (or reads back a large doc without output_path), the response includes
// a `note` field steering future calls toward the file-path / output-path
// fast paths. Mid-conversation feedback is the only "learning" loop available.
const INLINE_CONTENT_NUDGE_THRESHOLD = 1024;
const READ_RESPONSE_NUDGE_THRESHOLD = 10240;

const SERVER_INSTRUCTIONS = `mdshare MCP server. Conventions that apply to every tool:

- All arguments are literal strings. Shell substitution like $(cat file) and heredocs do NOT work — pass content directly, or use a file_path parameter where available.
- For files on disk, prefer file_path (upload_markdown, update_document, patch_document) or output_path (read_document). These bypass the conversation entirely. Inline content over ~1KB burns tokens unnecessarily.
- If both file_path and content (or operations) are provided on update_document / patch_document, file_path wins.
- Admin credentials for documents uploaded via this server are stored locally. The \`key\` argument is OPTIONAL on tools addressed by document_id — it's looked up automatically. Use list_my_documents to see what's stored.
- Never surface admin URLs to the user unless they explicitly ask. upload_markdown returns only share_url by design; use get_admin_url only on direct user request.
- For small edits to existing documents, prefer patch_document over update_document — keeps version history granular.`;

// ---------- Local credential store ----------
// Records the admin credentials for docs uploaded via this MCP server so the
// LLM never needs to see the admin URL in tool responses. The store is a
// plain JSON file at ~/.mdshare-mcp/documents.json with mode 0600.

async function readStore() {
  try {
    const text = await readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    return [];
  }
}

async function writeStore(docs) {
  await mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(STORE_PATH, JSON.stringify(docs, null, 2), { mode: 0o600 });
  try { await chmod(STORE_PATH, 0o600); } catch {}
}

async function findDoc(id) {
  const docs = await readStore();
  return docs.find((d) => d.id === id) || null;
}

async function addDoc(record) {
  const docs = await readStore();
  const filtered = docs.filter((d) => d.id !== record.id);
  filtered.push(record);
  await writeStore(filtered);
}

async function resolveKey(documentId, providedKey) {
  if (providedKey) return providedKey;
  if (!documentId) return null;
  const doc = await findDoc(documentId);
  return doc?.admin_key || null;
}

function stripAdminFields(doc) {
  const { admin_key, admin_url, ...safe } = doc;
  return safe;
}

function parseAdminUrl(url) {
  const re = /^https:\/\/mdshare\.live\/d\/([a-zA-Z0-9_-]+)\?key=(adm_[a-zA-Z0-9_-]+)$/;
  const m = typeof url === "string" && url.match(re);
  return m ? { documentId: m[1], adminKey: m[2] } : null;
}

function extractTitleFromMarkdown(markdown, fallback = "Untitled") {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function noKeyMessage(documentId) {
  return `No admin key found for document ${documentId}. Either (1) pass 'key' explicitly, (2) call register_document with the admin URL you have saved, or (3) call list_my_documents to see what this MCP server has stored locally.`;
}

// ---------- API helper ----------

async function callApi(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": options.contentType || "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

// ---------- Tool definitions ----------

const TOOLS = [
  {
    name: "upload_markdown",
    description:
      "Upload markdown to mdshare and receive a shareable link. The response contains a read/comment/edit share link (default permission: comment) that the user can share with others. The admin credential (full control) is stored locally in ~/.mdshare-mcp/documents.json and is NOT returned in this response — if the user explicitly asks to see or save the admin URL, call get_admin_url. PREFER file_path over content for files already on disk — reads directly from disk without transmitting content through this conversation, which is dramatically faster for files larger than ~1KB.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to a local markdown file. PREFERRED for any file already on disk — bypasses inline content transmission entirely.",
        },
        content: {
          type: "string",
          description: "Inline markdown content. Only use this for short snippets composed in the conversation. For files on disk, use file_path instead.",
        },
        share_permission: {
          type: "string",
          enum: ["view", "comment", "edit"],
          description: "Permission level for the share link returned to the user. Default 'comment' — recipients can read and comment. Use 'view' for read-only, 'edit' for full write access.",
        },
      },
    },
  },
  {
    name: "read_document",
    description:
      "Read a markdown document from mdshare. Returns the content. If the document was uploaded via this MCP server, 'key' is optional — the admin key will be loaded from local storage. PREFER output_path over inline reading for large documents — writes directly to disk and returns a small summary, dramatically faster than echoing content through the conversation.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID" },
        key: { type: "string", description: "Access key (admin, edit, comment, or view). Optional if the document is in this MCP server's local store." },
        output_path: {
          type: "string",
          description: "Optional. Absolute local file path to write the document content to. PREFERRED for documents larger than ~10KB — bypasses inline content transmission. When provided, the response is a small summary (saved_to, bytes) instead of the full content.",
        },
      },
      required: ["document_id"],
    },
  },
  {
    name: "update_document",
    description:
      "Update the content of an existing mdshare document (full replace). Requires edit or admin permission. If the document is in this MCP server's local store, 'key' is optional. PREFER file_path over content for files already on disk — reads directly from disk without transmitting content through this conversation. If both file_path and content are provided, file_path wins. For small edits to large documents, consider patch_document instead — keeps version history granular.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID" },
        key: { type: "string", description: "Edit or admin key. Optional if the document is in this MCP server's local store." },
        file_path: {
          type: "string",
          description: "Absolute path to a local markdown file. PREFERRED for any file already on disk — bypasses inline content transmission entirely.",
        },
        content: {
          type: "string",
          description: "Inline markdown content (full document body). Only use for short content composed in the conversation. For files on disk, use file_path instead.",
        },
        author: { type: "string", description: "Your name (for edit attribution)" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "patch_document",
    description:
      "Apply find/replace operations to a document without rewriting the full content. More efficient than update_document for small edits to large documents. Each find string must be unique unless replace_all is set. If the document is in this MCP server's local store, 'key' is optional. PREFER file_path over operations for batches of operations stored in a JSON file on disk — bypasses inline transmission. If both file_path and operations are provided, file_path wins.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID" },
        key: { type: "string", description: "Edit or admin key. Optional if the document is in this MCP server's local store." },
        file_path: {
          type: "string",
          description: "Absolute path to a local JSON file containing an array of {find, replace, replace_all?} operations. PREFERRED when the operations are already prepared on disk.",
        },
        operations: {
          type: "array",
          description: "Find/replace operations to apply sequentially. Use file_path instead for operations stored on disk.",
          items: {
            type: "object",
            properties: {
              find: { type: "string", description: "Text to find (must be unique in document)" },
              replace: { type: "string", description: "Text to replace with" },
              replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
            },
            required: ["find", "replace"],
          },
        },
        author: { type: "string", description: "Your name (for edit attribution)" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "generate_link",
    description:
      "Generate a share link for a document with specific permissions. Requires admin access. If the document is in this MCP server's local store, 'key' is optional.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID" },
        key: { type: "string", description: "Admin key. Optional if the document is in this MCP server's local store." },
        permission: {
          type: "string",
          enum: ["view", "edit", "comment"],
          description: "Permission level for the link",
        },
        label: { type: "string", description: "Optional label for the link" },
      },
      required: ["document_id", "permission"],
    },
  },
  {
    name: "list_links",
    description:
      "List all share links for a document, including status (active/revoked), permission, and label. Requires admin access. If the document is in this MCP server's local store, 'key' is optional.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID" },
        key: { type: "string", description: "Admin key. Optional if the document is in this MCP server's local store." },
      },
      required: ["document_id"],
    },
  },
  {
    name: "revoke_link",
    description:
      "Revoke a share link, making it permanently inactive. Use list_links first to find the token of the link to revoke. Requires admin access. If the document is in this MCP server's local store, 'key' is optional.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID (used to look up the admin key when 'key' is omitted)" },
        key: { type: "string", description: "Admin key. Optional if the document is in this MCP server's local store." },
        link_token: { type: "string", description: "The token of the link to revoke (from list_links)" },
      },
      required: ["document_id", "link_token"],
    },
  },
  {
    name: "list_comments",
    description:
      "List all comments on a document, including replies and resolution status. If the document is in this MCP server's local store, 'key' is optional.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID" },
        key: { type: "string", description: "Any valid access key. Optional if the document is in this MCP server's local store." },
      },
      required: ["document_id"],
    },
  },
  {
    name: "post_comment",
    description:
      "Post a comment on a document, optionally anchored to specific text. Can also reply to an existing comment. If the document is in this MCP server's local store, 'key' is optional.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID" },
        key: { type: "string", description: "Comment, edit, or admin key. Optional if the document is in this MCP server's local store." },
        content: { type: "string", description: "Comment text" },
        author_name: { type: "string", description: "Your name" },
        anchor_text: { type: "string", description: "Text in the document this comment refers to" },
        parent_id: { type: "string", description: "ID of the comment to reply to (one level nesting)" },
      },
      required: ["document_id", "content"],
    },
  },
  {
    name: "resolve_comment",
    description:
      "Resolve or unresolve a comment. Requires edit or admin permission. Key must be provided explicitly because comments are addressed by comment_id — the MCP server can't look up the parent document.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        comment_id: { type: "string", description: "Comment ID to resolve" },
        key: { type: "string", description: "Edit or admin key for the document" },
        resolved: { type: "boolean", description: "true to resolve, false to unresolve" },
      },
      required: ["comment_id", "key", "resolved"],
    },
  },
  {
    name: "get_versions",
    description:
      "Get the edit history of a document — who edited, when, and via what. If the document is in this MCP server's local store, 'key' is optional.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID" },
        key: { type: "string", description: "Any valid access key. Optional if the document is in this MCP server's local store." },
      },
      required: ["document_id"],
    },
  },
  {
    name: "list_my_documents",
    description:
      "List documents you've previously uploaded via this MCP server on this machine. Returns document_id, title, share_url, share_permission, created_at, and expires_at for each — does NOT return the admin credential. Use this to help the user find and resume older documents without re-pasting admin URLs. Does NOT include documents created via the mdshare web UI or via direct API calls from other clients — only those created by this MCP server. Returns an empty array on a fresh install or after the local store has been cleared.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_admin_url",
    description:
      "Retrieve the admin URL for a document previously uploaded via this MCP server. The admin URL grants full control and is equivalent to a password. ONLY call this tool when the user explicitly asks to see, save, or copy the admin URL — for example: 'give me the admin URL', 'save the admin link to my notes', 'what's the owner credential'. DO NOT call this as part of normal upload, share, or collaboration flows; the admin URL should never be surfaced to the user unless directly requested.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document ID (from upload_markdown response or list_my_documents)" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "register_document",
    description:
      "Register an mdshare admin URL you already have saved (in notes, chat history, emails, etc.) so it can be resumed without re-pasting the key every time. Takes an admin URL of the form https://mdshare.live/d/{id}?key=adm_..., verifies it against the live API, and stores it in ~/.mdshare-mcp/documents.json. Only accepts admin URLs (adm_ prefix) — view/comment/edit share links will be rejected. For bulk registration across many files, use the LLM's built-in file reading and search tools to find admin URLs, then call this tool once per URL found.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        admin_url: {
          type: "string",
          description: "Full admin URL: https://mdshare.live/d/{id}?key=adm_{token}",
        },
      },
      required: ["admin_url"],
    },
  },
];

// ---------- Tool handlers ----------
//
// Convention: handlers throw `Error` on user-input or business-logic failures.
// The outer dispatcher (CallToolRequestSchema handler) catches and translates
// to a spec-compliant `{ isError: true, content: [{type, text: JSON}] }` shape.
// Successful responses return a string (already JSON-stringified or raw text)
// which the dispatcher wraps as a normal text content block.

async function handleTool(name, args) {
  switch (name) {
    case "upload_markdown": {
      let body;
      let filenameTitle = null;
      if (args.file_path) {
        body = await readFile(args.file_path, "utf-8");
        const base = args.file_path.split("/").pop() || "";
        filenameTitle = base.replace(/\.mdx?$/i, "") || null;
      } else if (args.content) {
        body = args.content;
      } else {
        throw new Error("Must provide either file_path or content");
      }

      const sharePermission = args.share_permission || "comment";
      if (!["view", "comment", "edit"].includes(sharePermission)) {
        throw new Error("share_permission must be 'view', 'comment', or 'edit'");
      }

      // 1. Create document — receive admin credentials
      const createRes = await callApi("/api/documents", {
        method: "POST",
        contentType: "text/markdown",
        body,
      });
      if (createRes.status !== 201 && createRes.status !== 200) {
        throw new Error(`Failed to create document (HTTP ${createRes.status}): ${typeof createRes.data === "string" ? createRes.data : JSON.stringify(createRes.data)}`);
      }
      const created = createRes.data;
      const documentId = created.document_id;
      const adminKey = created.admin_key;
      const adminUrl = created.admin_url;
      const expiresAt = created.expires_at;

      const title = extractTitleFromMarkdown(body, filenameTitle || "Untitled");

      // 2. Generate a share link with the requested permission
      const linkRes = await callApi(
        `/api/d/${documentId}/links?key=${adminKey}`,
        {
          method: "POST",
          body: JSON.stringify({
            permission: sharePermission,
            label: "shared-via-mcp",
          }),
        }
      );

      const createdAt = new Date().toISOString();
      const record = {
        id: documentId,
        title,
        admin_key: adminKey,
        admin_url: adminUrl,
        share_url: null,
        share_permission: sharePermission,
        created_at: createdAt,
        expires_at: expiresAt,
      };

      if (linkRes.status === 201 || linkRes.status === 200) {
        record.share_url = linkRes.data.url;
      }

      // Local store write — if this fails, surface the admin URL because the
      // credential would otherwise be lost. This is the one place we MUST
      // expose the admin URL despite the no-leak rule.
      try {
        await addDoc(record);
      } catch (err) {
        return JSON.stringify({
          error: "Local credential storage failed — save this admin URL immediately, otherwise full control of the document will be lost. This is an exceptional error state.",
          document_id: documentId,
          admin_url_to_save_manually: adminUrl,
          expires_at: expiresAt,
          storage_error: err.message,
        }, null, 2);
      }

      if (!record.share_url) {
        return JSON.stringify({
          document_id: documentId,
          title,
          share_url: null,
          expires_at: expiresAt,
          warning: "Document created but share link generation failed. The admin credential was stored locally — call generate_link (no key needed) to create a share link now.",
        }, null, 2);
      }

      return JSON.stringify({
        document_id: documentId,
        title,
        share_url: record.share_url,
        share_permission: sharePermission,
        expires_at: expiresAt,
        note: `Share this link with anyone. Link permission: ${sharePermission}. The admin credential is stored locally; call get_admin_url only if the user explicitly asks for it.`,
      }, null, 2);
    }

    case "read_document": {
      const key = await resolveKey(args.document_id, args.key);
      if (!key) throw new Error(noKeyMessage(args.document_id));
      const { data } = await callApi(
        `/api/d/${args.document_id}?key=${key}`,
        { headers: { Accept: "text/markdown" }, contentType: "text/plain" }
      );
      const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      if (args.output_path && typeof data === "string") {
        await writeFile(args.output_path, content, "utf-8");
        return JSON.stringify({
          saved_to: args.output_path,
          bytes: Buffer.byteLength(content, "utf-8"),
        }, null, 2);
      }
      // Nudge wrapping for large inline reads — keeps small reads as raw text
      const bytes = Buffer.byteLength(content, "utf-8");
      if (typeof data === "string" && bytes > READ_RESPONSE_NUDGE_THRESHOLD) {
        return JSON.stringify({
          content,
          note: `${bytes} bytes returned inline. For future calls on large documents, pass output_path to write directly to disk and receive a compact summary instead.`,
        }, null, 2);
      }
      return content;
    }

    case "update_document": {
      const key = await resolveKey(args.document_id, args.key);
      if (!key) throw new Error(noKeyMessage(args.document_id));
      let body;
      let usedFilePath = false;
      if (args.file_path) {
        body = await readFile(args.file_path, "utf-8");
        usedFilePath = true;
      } else if (args.content) {
        body = args.content;
      } else {
        throw new Error("Must provide either file_path or content");
      }
      const headers = {};
      if (args.author) headers["X-Author"] = args.author;
      const { data } = await callApi(
        `/api/d/${args.document_id}?key=${key}`,
        { method: "PUT", contentType: "text/markdown", body, headers }
      );
      // Nudge if inline content was passed above threshold
      if (!usedFilePath && typeof data === "object" && data !== null) {
        const bytes = Buffer.byteLength(body, "utf-8");
        if (bytes > INLINE_CONTENT_NUDGE_THRESHOLD) {
          data.note = `${bytes} bytes transmitted inline. For future calls on files already on disk, use file_path to avoid this.`;
        }
      }
      return JSON.stringify(data, null, 2);
    }

    case "patch_document": {
      const key = await resolveKey(args.document_id, args.key);
      if (!key) throw new Error(noKeyMessage(args.document_id));
      let operations;
      let usedFilePath = false;
      if (args.file_path) {
        const fileText = await readFile(args.file_path, "utf-8");
        try {
          operations = JSON.parse(fileText);
        } catch {
          throw new Error("operations file must contain a JSON array of {find, replace} objects");
        }
        usedFilePath = true;
      } else {
        // Some MCP clients serialize array parameters as JSON strings instead
        // of native arrays — parse defensively so both cases work.
        operations = args.operations;
        if (typeof operations === "string") {
          try {
            operations = JSON.parse(operations);
          } catch {
            throw new Error("operations must be an array or a JSON-encoded array string");
          }
        }
      }
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new Error("operations must be a non-empty array of {find, replace} objects");
      }
      const requestBody = { operations };
      if (args.author) requestBody.author = args.author;
      const { data } = await callApi(
        `/api/d/${args.document_id}?key=${key}`,
        { method: "PATCH", body: JSON.stringify(requestBody) }
      );
      // Nudge if operations were passed inline (not from a file) and the
      // serialized array is large
      if (!usedFilePath && typeof data === "object" && data !== null) {
        const bytes = Buffer.byteLength(JSON.stringify(operations), "utf-8");
        if (bytes > INLINE_CONTENT_NUDGE_THRESHOLD) {
          data.note = `${bytes} bytes of operations transmitted inline. For future bulk patches, write the operations to a JSON file and pass file_path.`;
        }
      }
      return JSON.stringify(data, null, 2);
    }

    case "generate_link": {
      const key = await resolveKey(args.document_id, args.key);
      if (!key) throw new Error(noKeyMessage(args.document_id));
      const { data } = await callApi(
        `/api/d/${args.document_id}/links?key=${key}`,
        {
          method: "POST",
          body: JSON.stringify({
            permission: args.permission,
            label: args.label || null,
          }),
        }
      );
      return JSON.stringify(data, null, 2);
    }

    case "list_links": {
      const key = await resolveKey(args.document_id, args.key);
      if (!key) throw new Error(noKeyMessage(args.document_id));
      const { data } = await callApi(
        `/api/d/${args.document_id}/links?key=${key}`
      );
      return JSON.stringify(data, null, 2);
    }

    case "revoke_link": {
      const key = await resolveKey(args.document_id, args.key);
      if (!key) throw new Error(noKeyMessage(args.document_id));
      const { data } = await callApi(
        `/api/links/${args.link_token}?key=${key}`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: false }),
        }
      );
      return JSON.stringify(data, null, 2);
    }

    case "list_comments": {
      const key = await resolveKey(args.document_id, args.key);
      if (!key) throw new Error(noKeyMessage(args.document_id));
      const { data } = await callApi(
        `/api/d/${args.document_id}/comments?key=${key}`
      );
      return JSON.stringify(data, null, 2);
    }

    case "post_comment": {
      const key = await resolveKey(args.document_id, args.key);
      if (!key) throw new Error(noKeyMessage(args.document_id));
      const body = {
        content: args.content,
        author_name: args.author_name || "AI Assistant",
        anchor_text: args.anchor_text || null,
        parent_id: args.parent_id || null,
      };
      const { data } = await callApi(
        `/api/d/${args.document_id}/comments?key=${key}`,
        { method: "POST", body: JSON.stringify(body) }
      );
      return JSON.stringify(data, null, 2);
    }

    case "resolve_comment": {
      // Key required — comments addressed by comment_id, no parent doc lookup
      const { data } = await callApi(
        `/api/comments/${args.comment_id}?key=${args.key}`,
        {
          method: "PATCH",
          body: JSON.stringify({ resolved: args.resolved }),
        }
      );
      return JSON.stringify(data, null, 2);
    }

    case "get_versions": {
      const key = await resolveKey(args.document_id, args.key);
      if (!key) throw new Error(noKeyMessage(args.document_id));
      const { data } = await callApi(
        `/api/d/${args.document_id}/versions?key=${key}`
      );
      return JSON.stringify(data, null, 2);
    }

    case "list_my_documents": {
      const docs = await readStore();
      const safe = docs.map(stripAdminFields);
      return JSON.stringify({ documents: safe, count: safe.length }, null, 2);
    }

    case "get_admin_url": {
      if (!args.document_id) {
        throw new Error("document_id is required");
      }
      const doc = await findDoc(args.document_id);
      if (!doc) {
        throw new Error(`No stored record for document ${args.document_id}. If you have the admin URL saved elsewhere, use register_document to add it to the local store first.`);
      }
      return JSON.stringify({
        document_id: doc.id,
        title: doc.title,
        admin_url: doc.admin_url,
      }, null, 2);
    }

    case "register_document": {
      const parsed = parseAdminUrl(args.admin_url);
      if (!parsed) {
        throw new Error("Invalid admin URL format. Expected https://mdshare.live/d/{id}?key=adm_{token}. Only admin URLs (adm_ prefix) are accepted — view/comment/edit share links cannot be registered.");
      }
      const verify = await callApi(
        `/api/d/${parsed.documentId}?key=${parsed.adminKey}`,
        { headers: { Accept: "application/json" } }
      );
      if (verify.status !== 200 || typeof verify.data !== "object") {
        throw new Error(`Verification failed (HTTP ${verify.status}). The document may have expired, been deleted, or the admin key may be wrong. Not stored.`);
      }
      const docData = verify.data;
      const existing = await findDoc(parsed.documentId);
      const title = docData.title || existing?.title || extractTitleFromMarkdown(docData.content || "", "Untitled");
      const record = {
        id: parsed.documentId,
        title,
        admin_key: parsed.adminKey,
        admin_url: args.admin_url,
        share_url: existing?.share_url || null,
        share_permission: existing?.share_permission || null,
        created_at: existing?.created_at || docData.created_at || new Date().toISOString(),
        expires_at: docData.expires_at || existing?.expires_at || null,
      };
      try {
        await addDoc(record);
      } catch (err) {
        throw new Error(`Failed to write to local store: ${err.message}`);
      }
      return JSON.stringify({
        document_id: record.id,
        title: record.title,
        registered: true,
        already_existed: !!existing,
        expires_at: record.expires_at,
      }, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------- Server setup ----------

const server = new Server(
  { name: "mdshare", version: "1.4.0" },
  {
    capabilities: { tools: {} },
    instructions: SERVER_INSTRUCTIONS,
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args);
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: error.message }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
