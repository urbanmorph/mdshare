// The API reference, written once. /docs/raw serves DOCS_MARKDOWN as is (LLMs read it);
// /docs renders it with renderDocsHtml() when the site is built, so the page ships no JS.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import { sanitizeSchema } from "./markdown-schema.ts";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import type { Root, Element } from "hast";

export const DOCS_MARKDOWN = `# mdshare API

**Base URL:** \`https://mdshare.live\`

Zero-login markdown sharing. Upload, get links, collaborate. No accounts needed.

Please send a \`User-Agent\` that names your app (for example \`my-app/1.0\`). We read it only to tell how a document was made (the website, the API, our MCP server or command line, the VS Code or Obsidian plugin), and keep only that category with the document. We don't store the header, and we don't track who you are.

This reference as raw markdown: \`curl https://mdshare.live/docs/raw\`

---

## Quick Start

### Upload a document

\`\`\`bash
curl -X POST https://mdshare.live/api/documents \\
  -H "Content-Type: text/markdown" \\
  --data-binary @your-file.md
\`\`\`

**Response (201 Created):**

\`\`\`json
{
  "document_id": "abc123",
  "admin_key": "adm_xK9mQ4r8...",
  "admin_url": "https://mdshare.live/d/abc123?key=adm_xK9mQ4r8...",
  "expires_at": "2026-07-10T12:00:00.000Z"
}
\`\`\`

Save the \`admin_key\`: it's your master key. If lost, admin access is lost. Documents expire in 90 days (see \`expires_at\`).

### Read a document

\`\`\`bash
# JSON (default)
curl "https://mdshare.live/api/d/{id}?key={any_valid_key}"

# Raw markdown
curl -H "Accept: text/markdown" "https://mdshare.live/api/d/{id}?key={key}"
\`\`\`

The JSON response includes \`document_id\`, \`title\`, \`content\`, \`content_hash\`, \`permission\`, \`created_at\`, \`updated_at\`, \`expires_at\`, and edit attribution fields (\`last_edited_by\`, \`last_edited_via\`, \`last_edited_at\`).

### Update a document

\`\`\`bash
curl -X PUT "https://mdshare.live/api/d/{id}?key={edit_or_admin_key}" \\
  -H "Content-Type: text/markdown" \\
  -H "X-Author: Your Name" \\
  -H "X-Base-Hash: {content_hash}" \\
  --data-binary @updated.md
\`\`\`

\`X-Author\` is optional and names you in the version history. Send a name that isn't plain ASCII percent-encoded (\`encodeURIComponent(name)\`).

Saves are atomic. To avoid overwriting someone else's newer edit, send \`X-Base-Hash\` with the \`content_hash\` of the version your edit is based on (from a previous read or write). If the document has changed since, nothing is written: the response is \`409 Conflict\` with the latest \`content\` and \`content_hash\`. Without the header, the last write wins. \`PATCH\` accepts the same header.

### Patch a document (find/replace)

\`\`\`bash
curl -X PATCH "https://mdshare.live/api/d/{id}?key={edit_or_admin_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"operations": [{"find": "old text", "replace": "new text"}], "author": "Your Name"}'
\`\`\`

**Response:**

\`\`\`json
{
  "applied": 1,
  "operations": [{ "index": 0, "status": "ok" }],
  "content_hash": "abc123..."
}
\`\`\`

Use \`PATCH\` for a small edit to a large document: it doesn't resend unchanged content, and the version history records the specific change. Each \`find\` must be unique in the document unless that operation sets \`replace_all: true\`. Operations apply in order; if any \`find\` is not found, the whole patch fails and nothing is written. Statuses: \`ok\`, \`not_found\`, \`ambiguous\`, \`invalid\`.

### Generate a share link (admin only)

\`\`\`bash
curl -X POST "https://mdshare.live/api/d/{id}/links?key={admin_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"permission": "edit", "label": "for-team"}'
\`\`\`

**Response:**

\`\`\`json
{
  "token": "edt_7jP2r9kL...",
  "url": "https://mdshare.live/d/abc123?key=edt_7jP2r9kL...",
  "permission": "edit",
  "label": "for-team"
}
\`\`\`

Optional: add \`"expires_at": "2026-05-01T00:00:00Z"\` to make the link expire. It must be a valid ISO 8601 date in the future; anything else returns \`400\`.

---

## Key Types

| Prefix | Permission | Can do |
|--------|-----------|--------|
| \`adm_\` | Admin | Read, write, delete, manage links, manage comments |
| \`edt_\` | Edit | Read, write, comment |
| \`cmt_\` | Comment | Read, add comments |
| \`viw_\` | View | Read only |

---

## Endpoints

### Documents

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| \`POST\` | \`/api/documents\` | None | Create document. Body: raw markdown |
| \`GET\` | \`/api/d/:id?key=KEY\` | Any | Read document |
| \`PUT\` | \`/api/d/:id?key=KEY\` | Edit/Admin | Update document (full rewrite). Optional \`X-Base-Hash\`, \`X-Author\` |
| \`PATCH\` | \`/api/d/:id?key=KEY\` | Edit/Admin | Patch document (find/replace). Body: \`{operations: [{find, replace, replace_all?}], author?}\` |
| \`DELETE\` | \`/api/d/:id?key=KEY\` | Admin | Delete document |
| \`PUT\` | \`/api/d/:id/expiry?key=KEY\` | Admin | Change when the document is deleted. Body: \`{expires_at}\` (ISO 8601, in the future, at most 1 year from now) |

### Links (admin only)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| \`POST\` | \`/api/d/:id/links?key=KEY\` | Admin | Create share link. Body: \`{permission, label, expires_at}\` |
| \`GET\` | \`/api/d/:id/links?key=KEY\` | Admin | List all links, each with its \`id\` and URL |
| \`PATCH\` | \`/api/links/:id?key=KEY\` | Admin | Modify or revoke link (set \`is_active\`, \`permission\`, \`label\`) |
| \`DELETE\` | \`/api/links/:id?key=KEY\` | Admin | Delete link permanently |

\`:id\` in \`/api/links/:id\` is the link's \`id\` from \`GET /api/d/:id/links\`. The link's token still works there too, for older clients. The admin link can't be modified or deleted.

Up to **50 active share links** per document. Revoked links and the admin link don't count.

### Comments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| \`POST\` | \`/api/d/:id/comments?key=KEY\` | Comment/Edit/Admin | Add comment. Body: \`{content, author_name, anchor_text, parent_id}\`. Replies nest one level. |
| \`GET\` | \`/api/d/:id/comments?key=KEY\` | Any | List comments |
| \`PATCH\` | \`/api/comments/:id?key=KEY\` | Edit/Admin | Resolve/unresolve comment. Body: \`{resolved: true}\` |

### Versions (edit history)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| \`GET\` | \`/api/d/:id/versions?key=KEY\` | Any | List edit history (who, when, via what). Last 50 entries |

The \`GET /api/d/:id\` response also includes \`last_edited_by\`, \`last_edited_via\`, and \`last_edited_at\` fields.

### Presence

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| \`POST\` | \`/api/d/:id/presence?key=KEY\` | Any | Heartbeat. Body: \`{session_id, name}\`. Returns viewers list |
| \`GET\` | \`/api/d/:id/presence?key=KEY\` | Any | Get who's currently online |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| \`POST /api/documents\` | 10 per minute, 50 per day per IP |
| \`PUT\` and \`PATCH /api/d/:id\` | 30 per minute per IP |
| \`POST /api/d/:id/comments\` | 20 per minute per IP |
| \`POST /api/d/:id/poll\` | 20 per minute per IP |
| \`POST /api/d/:id/links\` | 20 per minute per IP |
| \`PUT /api/d/:id/expiry\` | 10 per minute per IP |
| \`PATCH /api/comments/:id\` | 30 per minute per IP |

Rate-limited responses return \`429\` with a \`Retry-After\` header.

---

## Document Expiry

- Documents expire **90 days** after creation by default
- An admin can move the expiry to any future date up to 1 year from now with \`PUT /api/d/:id/expiry\`
- Every API route returns \`410 Gone\` for an expired document
- Share links may have their own expiry (set via \`expires_at\` when creating a link)
- The \`POST /api/documents\` response includes \`expires_at\` with the expiry date

---

## Errors

| Code | Meaning |
|------|---------|
| \`400\` | Bad request: malformed JSON, invalid content (binary file, empty, too large), an invalid date, or a field over its length limit |
| \`403\` | Insufficient permission |
| \`404\` | Document not found or invalid key |
| \`409\` | Conflict: the document changed since \`X-Base-Hash\`; nothing was written (the response carries the latest \`content\` and \`content_hash\`) |
| \`410\` | Document has expired |
| \`429\` | Rate limited (check \`Retry-After\` header) |

Length limits, in characters (over a limit is a \`400\`): comment content 10,000; author name 100; anchor text 5,000; link label 200. Titles longer than 200 characters are cut to 200.

---

## Notes

- Content is sanitized server-side (no raw HTML, XSS protection)
- Binary files are rejected (magic byte detection for 24+ formats)
- Links only allow \`http:\`, \`https:\`, \`mailto:\` protocols
- Max document size: 10MB
- All content should be treated as user-generated
- API responses include \`X-Content-Source: user-generated\` header
- Write endpoints (POST/PUT/PATCH) return \`Server-Timing\` headers and a \`processing_ms\` field for latency tracking

---

## Use with AI

> See [Share markdown with AI](https://mdshare.live/share-markdown-with-ai) for a dedicated guide with per-client setup, tool reference, and FAQs.

### MCP setup

\`npx mdshare-mcp\` runs the MCP server over stdio for Claude, ChatGPT/Codex, Gemini CLI, Cursor and Windsurf. It has 15 tools for uploading, editing, links, comments, versions and expiry. Admin keys stay on your machine.

#### Claude Desktop / Claude Code

Claude Desktop: add this to \`claude_desktop_config.json\` (macOS: \`~/Library/Application Support/Claude/\`; Windows: \`%APPDATA%\\Claude\\\`). Claude Code: \`claude mcp add mdshare -- npx -y mdshare-mcp\`, or the same JSON.

\`\`\`json
{
  "mcpServers": {
    "mdshare": {
      "command": "npx",
      "args": ["mdshare-mcp"]
    }
  }
}
\`\`\`

#### OpenAI Codex CLI, Gemini CLI, Cursor and Windsurf

Add the same \`mcpServers\` entry to the client's config file:

| Client | Config file |
|--------|-------------|
| OpenAI Codex CLI | \`~/.codex/config.json\` |
| Gemini CLI | \`~/.gemini/settings.json\` |
| Cursor | \`~/.cursor/mcp.json\` |
| Windsurf | \`~/.codeium/windsurf/mcp_config.json\` |

### Command line

The same package is a command line. With a command it shares files from a terminal or script; with no arguments (how MCP clients start it) it is the MCP server.

\`\`\`bash
npx mdshare-mcp upload notes.md            # prints a share link
npx mdshare-mcp update <doc-id> notes.md   # refuses if someone edited it since
npx mdshare-mcp --help                     # every command
\`\`\`

### Hosted, read only

\`https://mdshare.live/mcp\` is an MCP server over Streamable HTTP, with nothing to install. Give it a share link and it can \`read_document\`, \`list_comments\` or \`get_versions\`. It refuses admin links and stores or logs no keys. The hosted MCP server keeps nothing about its callers. To upload or edit, use the npm package.

### What to tell your AI

- "Upload my-notes.md to mdshare and give me an edit link"
- "Read this mdshare document and summarize the comments"
- "Incorporate the feedback and resolve the comments"
- "Share this markdown with view-only access"
- "Who edited this document last?"
- "Post a comment on the budget section"
- "List all links for this document"
- "Revoke the edit link I shared with the team"
- "Save this mdshare document to /tmp/notes.md"

**Tip:** when uploading a file already on disk, the MCP server reads it directly via \`file_path\` instead of echoing the bytes through the conversation, which is much faster. Same for downloads via \`output_path\`.

### Without MCP (works with any AI)

No setup needed. Tell your AI chatbot:

\`\`\`text
Read https://mdshare.live/docs/raw to learn the mdshare API,
then upload this markdown and give me a share link.
\`\`\`

Works with Claude, ChatGPT, Gemini, Copilot, or any AI that can make HTTP calls.

---

## VS Code extension

Share markdown files directly from VS Code. Right-click any \`.md\` file or select text and share it. Also works in **Cursor** and **Windsurf**, since they support the VS Code extension format.

### Install

1. Open the **Extensions** panel in VS Code (\`Cmd+Shift+X\` or \`Ctrl+Shift+X\`)
2. Search for **mdshare** and click **Install**, or install from the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=urbanmorph.mdshare-live)

Or install manually: download [mdshare-vscode.vsix](https://mdshare.live/mdshare-vscode.vsix), then \`Cmd+Shift+P\` → **Install from VSIX**.

### Usage

- **Share a file:** right-click a \`.md\` file in the Explorer → "Share on mdshare"
- **Share a selection:** select text in any editor → right-click → "Share Selection on mdshare"

The admin URL is copied to your clipboard.

---

## Obsidian plugin

Share markdown files directly from Obsidian. Right-click any file, select text, or use the command palette. Listed in the official [Obsidian Community Plugins directory](https://community.obsidian.md/plugins/mdshare).

### Install via Community Plugins (recommended)

1. Open Obsidian → Settings → Community Plugins
2. If you haven't already, turn off Restricted Mode
3. Click **Browse** and search for \`mdshare\`
4. Click **Install**, then **Enable**

### Alternative: BRAT (for beta builds)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. In BRAT settings, click "Add Beta Plugin"
3. Enter: \`urbanmorph/obsidian-mdshare\`

Use BRAT only if you want to test pre-release builds before they ship to the directory.

### Alternative: manual install

1. Download [main.js](https://mdshare.live/obsidian-mdshare-main.js) and [manifest.json](https://mdshare.live/obsidian-mdshare-manifest.json), saved under those two names
2. Create a folder: \`<your-vault>/.obsidian/plugins/mdshare/\`
3. Copy both files into that folder
4. Enable in Settings → Community Plugins

### Usage

- **Share a file:** right-click a file in the explorer → "Share on mdshare"
- **Share a selection:** select text → right-click → "Share selection on mdshare"
- **Command palette:** \`Cmd/Ctrl+P\` → "mdshare: Share current file"

The admin URL is copied to your clipboard.
`;

const SITE = "https://mdshare.live";

// Section anchors other pages link to (/docs#vscode, /docs#obsidian); other h2s get a slug.
const ANCHORS: Record<string, string> = { "VS Code extension": "vscode", "Obsidian plugin": "obsidian" };

// Files that must keep their plugin names when downloaded.
const DOWNLOAD_AS: Record<string, string> = {
  "/obsidian-mdshare-main.js": "main.js",
  "/obsidian-mdshare-manifest.json": "manifest.json",
};

const textOf = (node: Element): string =>
  node.children.map((c) => (c.type === "text" ? c.value : c.type === "element" ? textOf(c) : "")).join("");

// Runs after sanitizing (which would prefix ids with "user-content-"): gives each h2 an id,
// makes links to this site relative and opens other sites in a new tab.
function docsPage() {
  const walk = (parent: Root | Element) => {
    for (const node of parent.children) {
      if (node.type !== "element") continue;
      walk(node);
      if (node.tagName === "h2") {
        const text = textOf(node);
        node.properties.id = ANCHORS[text] ?? text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      } else if (node.tagName === "a" && typeof node.properties.href === "string") {
        const href = node.properties.href;
        if (href.startsWith(`${SITE}/`)) {
          const path = href.slice(SITE.length);
          node.properties.href = path;
          if (DOWNLOAD_AS[path]) node.properties.download = DOWNLOAD_AS[path];
        } else if (href.startsWith("https://")) {
          node.properties.target = "_blank";
          node.properties.rel = ["noopener", "noreferrer"];
        }
      }
    }
  };
  return walk;
}

// Rendered like documents are (components/editor/markdown-html.ts), with the same sanitizer.

export function renderDocsHtml(markdown: string = DOCS_MARKDOWN): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeHighlight, { detect: true, ignoreMissing: true })
      .use(rehypeSanitize, sanitizeSchema)
      .use(docsPage)
      .use(rehypeStringify)
      .processSync(markdown),
  );
}
