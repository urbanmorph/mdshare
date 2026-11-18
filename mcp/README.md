# mdshare-mcp

Share markdown from your AI or your terminal with [mdshare](https://mdshare.live): you get a link, and **anyone with it can comment and edit, with no account**. Free.

One package, two modes: an MCP server for Claude, ChatGPT/Codex, Gemini CLI, Cursor and Windsurf, and a [command line](#command-line) for scripts and CI.

## Install

```
npx mdshare-mcp
```

Or add to your AI tool's config:

```json
{
  "mcpServers": {
    "mdshare": {
      "command": "npx",
      "args": ["mdshare-mcp"]
    }
  }
}
```

Config file locations:
- **Claude Desktop:** `claude_desktop_config.json` in `~/Library/Application Support/Claude/` (macOS) or `%APPDATA%\Claude\` (Windows)
- **Claude Code:** `claude mcp add mdshare -- npx -y mdshare-mcp`
- **Codex CLI:** `~/.codex/config.json`
- **Gemini CLI:** `~/.gemini/settings.json`
- **Cursor:** `~/.cursor/mcp.json`
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`

For **Claude Code / Claude Desktop**, you can skip manual config and install via the bundled plugin:

```
/plugin marketplace add urbanmorph/mdshare
/plugin install mdshare@urbanmorph
```

For **Cursor**, install via the [Cursor Directory listing](https://cursor.directory/plugins/mdshare) (click "Add to Cursor") instead of editing `~/.cursor/mcp.json` manually.

## Command line

With a command, `mdshare-mcp` is a CLI (with no arguments it stays the MCP server, so client configs don't change). Content comes from a file or `-` for stdin and never passes through a chat.

```bash
mdshare-mcp upload notes.md                      # prints a share link (comment); the admin key is stored, not shown
pandoc report.docx -t gfm | mdshare-mcp upload - --title "Q3 report" --expires 30d
mdshare-mcp update <doc-id> notes.md             # refuses if someone changed it since your last upload, update or read
mdshare-mcp read <doc-id|link> -o current.md
mdshare-mcp ls                                   # documents stored on this machine
mdshare-mcp link <doc-id> --edit --expires 30d   # also --view, --comment
mdshare-mcp comments <doc-id>; mdshare-mcp comment <doc-id> "Looks good"; mdshare-mcp resolve <doc-id> <comment-id>
mdshare-mcp links <doc-id>; mdshare-mcp revoke <doc-id> <link-token>; mdshare-mcp expire <doc-id> 90d; mdshare-mcp versions <doc-id>
mdshare-mcp admin-url <doc-id>                   # the only command that prints the admin URL
```

- **One link that stays current:** in CI or cron, `upload` once, then `update <doc-id> report.md` on every run. Because `update` is based on the version you last wrote or read, it never overwrites a teammate's edits: on a conflict nothing is written and it exits 1; `read -o`, merge, and update again (`--force` overwrites on purpose).
- `--json` on any command for scripts. Results go to stdout, messages to stderr; exit codes 0 ok, 1 failure, 2 bad usage.
- Keys come from the same store as the MCP tools (`~/.mdshare-mcp/documents.json`), never from arguments, so they stay out of shell history.
- A document lives at most a year ahead (`expire` up to `365d`).
- `npm i -g mdshare-mcp`, or `npx -y mdshare-mcp upload notes.md`. The npm name `mdshare` belongs to another project; if you like, `alias mdshare='npx -y mdshare-mcp'`.

## Read a link without installing (hosted)

Someone sent you an mdshare link and you're in Claude.ai, ChatGPT or another client that connects by URL? Add `https://mdshare.live/mcp` as a remote MCP server (Claude Code: `claude mcp add --transport http mdshare https://mdshare.live/mcp`) and pass the link.

It has three read-only tools: `read_document`, `list_comments` and `get_versions`. It **refuses admin links**, uses any other link only to read, and stores and logs no keys. The hosted MCP server keeps nothing about its callers. Uploading, editing, comments, links and expiry stay in this package, which keeps admin links on your machine.

## Tools

| Tool | What it does |
|------|-------------|
| `upload_markdown` | Upload markdown by `file_path` (preferred for files on disk) or inline `content`. Returns a share link (default permission: `comment`). Admin credential is stored locally — see below. |
| `read_document` | Read a document by ID + key, optionally save to `output_path` on disk. Large and saved reads also return `content_hash`. |
| `update_document` | Update content (edit/admin key). Optional `base_hash` refuses to overwrite newer edits. |
| `patch_document` | Find/replace operations without rewriting the full document. Optional `base_hash`, as above. |
| `generate_link` | Create view/edit/comment link (admin key) |
| `list_links` | List all share links with status (admin key) |
| `revoke_link` | Revoke a share link permanently (admin key) |
| `list_comments` | See all comments and replies |
| `post_comment` | Add a comment, optionally anchored to text |
| `resolve_comment` | Resolve or unresolve a comment |
| `get_versions` | See edit history (who, when) |
| `list_my_documents` | List documents you've uploaded via this MCP server on this machine. No admin credential leaked. |
| `get_admin_url` | Retrieve the admin URL for a previously-uploaded document. **Only call when the user explicitly asks.** |
| `register_document` | Register a previously-saved admin URL into the local store for resume |

### `key` is optional on most tools

As of v1.3.0, the `key` parameter is optional on every tool except `resolve_comment`. If you created the document via this MCP server (or registered it with `register_document`), the admin key is loaded from the local store automatically. Pass `key` explicitly when you want to act as a non-admin user (e.g., posting a comment with an edit-level key).

### Avoiding overwrites with `base_hash` (v1.5.0)

Other people may be editing the same document. Pass `base_hash` on `update_document` or `patch_document` with the `content_hash` of the version your edit is based on. You get it from `read_document` (with `output_path`, or on large reads) or from your previous update or patch response. If the document has changed since, nothing is written and the tool returns `{"error": "conflict", "content_hash": "..."}`: read the document again, reapply your edit, and retry. Without `base_hash`, writes behave as before (last write wins).

## Local credential store

v1.3.0 introduces a local credential store so the admin URL never needs to appear in chat responses.

**Where:** `~/.mdshare-mcp/documents.json` (chmod 0600, owner-readable only)

**What's in it:** for every doc you upload via this MCP server, a record with `{id, title, admin_key, admin_url, share_url, share_permission, created_at, expires_at}`.

**What this buys you:**

- **No admin-URL leaks.** `upload_markdown` returns only the read/comment share link. The admin URL stays on disk.
- **Cross-session resume.** Days or weeks later, call `patch_document` or `post_comment` with just the `document_id` — the stored admin key is used automatically. No pasting, no re-logging-in.
- **Ask for the admin URL on demand.** If you need the admin URL for a specific doc (to save in Notion, paste into an email, etc.), just say so — the LLM will call `get_admin_url` and return it.

**Moving between machines:** copy `~/.mdshare-mcp/documents.json` to the same path on the new machine. That's it — no remote sync, no accounts.

**Already have admin URLs saved elsewhere?** Use `register_document` to add them to the store. For bulk import, ask the LLM to scan your notes folder with its built-in file-search tools and call `register_document` for each URL found.

## What to say

- "Upload my-notes.md to mdshare and give me a share link"
- "Upload my-notes.md with edit permission so my team can work on it"
- "Save this mdshare document to /tmp/notes.md"
- "Read this mdshare document and summarize the comments"
- "Incorporate the feedback and resolve the comments" (uses stored admin key)
- "Share this markdown with view-only access"
- "Revoke the edit link I shared earlier"
- "List all links for this document"
- "Who edited this document last?"
- **"Resume the doc I made yesterday about Safe Routes to School"** — LLM calls `list_my_documents`, finds it, then operates on it without re-pasting
- **"Give me the admin URL for the Safe Routes doc so I can save it to my Notion"** — explicit ask, LLM calls `get_admin_url`
- **"Scan ~/notes for mdshare admin URLs and register them all"** — LLM uses its built-in file tools to find the URLs, then calls `register_document` for each

## Tip: file_path beats inline content

For files already on disk, the tool reads them directly via `file_path` rather than echoing every byte through the conversation. This is dramatically faster for AI workflows because the LLM doesn't need to generate the entire file as a tool-call parameter. Same applies in reverse for downloads via `output_path`.

## Without MCP

Works with any AI chatbot via curl:

```
Read https://mdshare.live/docs/raw to learn the mdshare API,
then upload this markdown and give me a share link.
```

## Links

- **App:** https://mdshare.live
- **API Docs:** https://mdshare.live/docs
- **GitHub:** https://github.com/urbanmorph/mdshare
