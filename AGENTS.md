# This app runs on Astro 5 + Cloudflare Workers

mdshare uses Astro 5 with the `@astrojs/cloudflare` adapter, deployed natively to Cloudflare Workers (no OpenNext, no Next.js). React components are used as Astro islands. If you're unsure about an Astro API, conventions, or config option, read the relevant guide in `node_modules/astro/dist/docs/` (or check https://docs.astro.build) before writing code. Heed deprecation notices.

## Things that may surprise you

- **API routes use `cloudflare:workers` env import**, not `getCloudflareContext()`. Pattern: `import { env } from "cloudflare:workers"; const db = env.DB;`
- **`Astro.params` is synchronous** in Astro 5 (not a Promise like Next.js 15 routes)
- **Static pages are pre-rendered** with `export const prerender = true` — they ship 0KB worker code and serve from CDN
- **Dynamic pages need `export const prerender = false`**
- **React islands use `client:load` / `client:only="react"`**, not `"use client"` directives
- **Custom worker entry**: `src/worker.ts` is the actual Cloudflare Worker entry. It exports a `createExports(manifest)` function that wraps Astro's `handle()` to add WebSocket bypass, security headers, and Durable Object exports
- **`public/.assetsignore`** prevents wrangler from refusing to upload because `_worker.js` lives inside the assets directory
- **No middleware.ts** — security headers are added in `src/worker.ts` after Astro's response
