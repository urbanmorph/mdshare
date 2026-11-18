@AGENTS.md

# mdshare

## Project Philosophy

mdshare is deliberately minimal. The core value is: upload markdown, get a link, share it. That's it.

**Design principles:**
- **Simple over powerful** — if a feature needs explanation, it's too complex
- **Zero friction** — no login, no setup, no configuration. Paste and go.
- **Invisible infrastructure** — users shouldn't know or care about the tech stack
- **Features earn their place** — every feature must make the core flow faster or clearer. If it adds a button, menu, or step, it needs strong justification.
- **Don't build what users haven't asked for** — resist speculative features

**What mdshare is NOT:**
- Not a Google Docs competitor (no real-time cursors, no track changes)
- Not a CMS or wiki
- Not a note-taking app
- Not a collaboration platform with user accounts

**When evaluating new features, ask:**
1. Does this make upload → share → collaborate faster?
2. Can a first-time user figure it out without instructions?
3. Does it add UI clutter?
4. Could this be solved by the user's existing tools instead?

## Tech Stack

- Astro 5 on Cloudflare Workers (native, via `@astrojs/cloudflare` adapter)
- React 19 as Astro islands (`client:load`, `client:only="react"`)
- Cloudflare D1 (SQLite), Durable Objects (WebSocket)
- Tiptap editor with tiptap-markdown
- Tailwind CSS v4
- CI/CD: GitHub Actions → `astro build && wrangler deploy` on push to main

## Key Files

- `lib/sanitize.ts` — content sanitization pipeline (security-critical)
- `lib/tokens.ts` — token generation and verification
- `lib/permissions.ts` — permission resolution from tokens (`resolveAccess`, `findLink`)
- `lib/authorize.ts` — the one gate every API route uses: key → link → document, permission check, 404/403/410
- `lib/commit.ts` — the save path for PUT and PATCH (sanitize, conditional write, 409 on a lost race, broadcast)
- `lib/request.ts` / `lib/limits.ts` — JSON bodies, input caps (shared with the browser), rate-limit helper
- `lib/db.ts` — D1 access via `cloudflare:workers` env
- `lib/db-types.ts` — D1 row types (separated so client code can import without runtime)
- `lib/broadcast.ts` — DO broadcast helper, called from `commitContent`
- `lib/security-headers.ts` — headers the Worker sets; `public/_headers` must match (tested)
- `lib/docs-content.ts` — the API docs: `/docs/raw` serves it, `/docs` renders it at build time
- `lib/faq.ts` — SEO pages render their FAQ and its JSON-LD from one list
- `src/pages/` — Astro pages (file-based routing)
- `src/pages/api/` — all REST API routes (Astro endpoints)
- `src/pages/d/[id].astro` — document page: one D1 query, dynamic OG tags; the island renders client-side
- `src/components/DocumentView.tsx` — document page island; sync logic in `lib/use-document-sync.ts`, header/status bar in `DocumentParts.tsx`. The editor is lazy-loaded so view-only readers never download Tiptap (tested)
- `src/worker.ts` — custom worker entry with WebSocket bypass + DO export + cron
- `src/layouts/Layout.astro` — HTML shell, meta tags, JSON-LD, fonts
- `worker/document-ws.ts` — Durable Object: pushes server-sanitized content to open documents (clients never relay content)
- `components/editor/` — Tiptap editor, toolbar, comments, highlights
- `public/.assetsignore` — prevents wrangler from uploading `_worker.js` as an asset

## Versions are pinned

`astro`, `@astrojs/cloudflare`, and `@astrojs/react` are pinned to exact versions in `package.json` (no `^`) to prevent accidental upgrades. Astro 6 has a known picomatch CJS bug with the Cloudflare adapter — do NOT upgrade to Astro 6 until it's resolved.

## Cloudflare Token

The project uses its own Cloudflare API token (separate from other projects).
Store in `.dev.vars` for local dev. CI/CD uses GitHub secrets.
Prefix wrangler commands with the token: `CLOUDFLARE_API_TOKEN=... npx wrangler ...`
