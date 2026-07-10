# How mdshare follows PDGI

[mdshare](https://mdshare.live) is built on the principles of [People's Digital Goods and Infrastructure (PDGI)](https://pdgi.org/blog/peoples-digital-goods-and-infrastructure/): people before digital, rights-centric, commons-oriented, transparent.

This is a public scorecard of how those principles are actually implemented, with links to the evidence and honest notes on where we fall short. mdshare is deliberately small — upload markdown, get a link, share it — so the principles that bite hardest here are the ones about a stranger's content: **privacy, rights, and transparency**.

Status key: ✅ implemented · 🟡 partial · ⛳ gap, with intended direction · ⚪ not applicable.

## Scorecard

### People before digital (your content, your keys) — ✅

mdshare asks for nothing about you. No account, no email, no login exists to create or read a document — a document is reached by a capability URL you hold, and the permission tier (admin / edit / comment / view) is set by whoever shares the link, not by us. From the admin URL you can change how long the document lives or revoke any share link at will, and walking away is as simple as letting it expire. Your content is never gated behind an identity.
Evidence: keyless creation and capability-URL access in [src/pages/api/documents.ts](src/pages/api/documents.ts) and [lib/permissions.ts](lib/permissions.ts); the admin expiry and revoke controls in `src/pages/api/d/[id]/expiry.ts` and `src/pages/api/links/[token].ts`.

### Transparency and accountability — ✅

Open source (MIT), open repository, and this scorecard with its git history as the public record. The [privacy policy](https://mdshare.live/privacy) states exactly what is and isn't collected, and the security-critical content pipeline — sanitisation of every document we store and serve — is open to inspection.
Evidence: [the repository](https://github.com/urbanmorph/mdshare), [LICENSE](LICENSE), [lib/sanitize.ts](lib/sanitize.ts), [/privacy](https://mdshare.live/privacy).

### Decentralisation and no lock-in — ✅

No account, no signup, no API key. Markdown goes in and the same markdown comes back out — request any document with `Accept: text/markdown` and you get the raw source, not a proprietary blob. The whole app is an Astro build on a single Cloudflare Worker, open and self-hostable. Nothing is trapped in the platform.
Evidence: the raw-markdown response in `src/pages/api/d/[id].ts`, the MIT repo, and the self-contained Worker in [src/worker.ts](src/worker.ts).

### Free software and the digital commons — ✅

MIT-licensed code, and the integrations around it — the MCP server, the VS Code extension, the Obsidian plugin — are open too. The value is a free, no-friction utility, not a walled service.
Evidence: [LICENSE](LICENSE), [mcp/](mcp/), and the published integrations.

### Privacy — ✅

This is where a markdown-sharing service earns or loses trust, so it gets the most scrutiny.

- **No accounts, no email, no behavioural profiles.** There is nothing to log in to and no identity to track.
- **No third-party trackers or cross-site requests.** The UI font (Geist) is self-hosted, so loading a page contacts no one but mdshare; the only analytics is Cloudflare Web Analytics, which is cookieless and aggregate.
- **Capability tokens are encrypted at rest.** The admin and share tokens stored in the database are AES-GCM encrypted under a key held only in the Worker's environment, so a database leak alone yields no working tokens — a request still authenticates against a separate hash, never the stored token.
- **Documents aren't indexed.** Every `/d/*` response carries `X-Robots-Tag: noindex, nofollow`, so shared content isn't crawled into search engines.
- **Real, honest erasure.** The default 90-day expiry can be brought forward from the admin URL to delete sooner, share links can be revoked instantly, and deletion cascades to comments, version history, and links — the GDPR/DPDPA rights in the policy map to controls that genuinely exist.
- **Honest note:** the Open Graph preview-card generator fetches fonts from Google *server-side* to render a document's title in its own script (including non-Latin ones). This is mdshare's server talking to Google — no visitor IP is ever involved — but it is a remaining third-party dependency, kept because it preserves multilingual link previews.

Evidence: token encryption in [lib/token-crypto.ts](lib/token-crypto.ts), the self-hosted [public/fonts/](public/fonts/), the noindex header in [src/worker.ts](src/worker.ts), and [/privacy](https://mdshare.live/privacy).

### Humans in the loop (AI does not cut people out) — ✅

mdshare is a tool people and their AI agents use together, not an autopilot. Every document is user-generated content (served with an `X-Content-Source: user-generated` marker), an AI agent reaches it only through a capability URL a human chose to share, and agent edits pass the same sanitisation and permission checks as human ones. The MCP server hands agents scoped links, never raw database access.
Evidence: the `X-Content-Source` marker in `src/pages/api/d/[id].ts`, the permission gate in [lib/permissions.ts](lib/permissions.ts), and the [MCP server](mcp/).

### Built to be built on (cooperativism for infrastructure) — ✅

mdshare's reason to exist is to be a piece others build markdown-sharing on top of. It ships an MCP server for AI agents, a VS Code extension, an Obsidian plugin, a plain REST API, and raw-markdown export — a low floor for anyone to add "share this markdown" to their own tool. It is not a publish-and-earn platform, so there is no contributor revenue model; the cooperativism is in keeping the surface open and free.
Evidence: [mcp/](mcp/), the REST endpoints under [src/pages/api/](src/pages/api/), and the `Accept: text/markdown` export.

### A non-digital alternative must exist — ⚪ not applicable

The PDGI clause is self-scoping: "no critical digital service on which a person's life and wellbeing depends should exist without easily accessible non-digital alternatives." mdshare is a convenience utility for sharing markdown, not a life-critical service (health, banking, civic identity), so the clause does not bite. What content it does hold is plain text — always exportable and printable, never locked to the platform.

### Grassroots and reaching the divide-affected — 🟡

Content is genuinely polyglot: mdshare detects a document's script and sets the right language, direction, and rendering, and it renders non-Latin content in the reader's own system fonts with no third-party dependency. What's still English-only is the *interface* chrome — the buttons and labels around the content.
Direction: localise the UI once a language crosses a meaningful share of documents (current bar ~15–20%); until then the polyglot content path is the priority, not premature UI translation.
Evidence: script detection in [lib/detect-script.ts](lib/detect-script.ts).

### Algorithmic fairness — ⚪ not applicable

mdshare runs no algorithm that makes a decision about a person; it stores and serves markdown. The one classifier in the system labels a document's *source* (paste, upload, MCP, API…) from request headers to understand traffic — it categorises requests, never people, and feeds no ranking or gating.

## Fork this

Want to show your project follows PDGI? Map each principle to the concrete thing you do, link the evidence, and mark the gaps honestly. Copy this file as a template and keep it in your repo, where its git history becomes the record of your work. (We forked it from [mugilu](https://github.com/urbanmorph/mugilu/blob/main/PDGI.md), which forked it from [bharatlas](https://github.com/urbanmorph/geodata/blob/main/PDGI.md).)

Built by [Urban Morph](https://urbanmorph.com). PDGI framework: [pdgi.org](https://pdgi.org/).
