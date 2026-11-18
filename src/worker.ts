// Custom worker entry point for Astro 5 + Cloudflare Workers
// Handles: Astro pages/API, WebSocket upgrades, Durable Objects, Cron

import type { SSRManifest } from "astro";
import { App } from "astro/app";
import { handle } from "@astrojs/cloudflare/handler";
import { resolveAccess, isExpired } from "../lib/permissions";
import { SECURITY_HEADERS } from "../lib/security-headers";
import { MCP_VERSION } from "../lib/version";
import { runCleanup } from "../lib/cleanup";

type IncomingRequest = Parameters<ExportedHandlerFetchHandler>[0];

// Re-export the Durable Object class
import { DocumentWebSocket } from "../worker/document-ws";
import { isSessionGone, logUrl } from "../lib/ws-errors";
import { handleMcp } from "../lib/hosted-mcp";
import { checkRateLimit } from "../lib/rate-limit";
export { DocumentWebSocket };

interface Env {
  DB: D1Database;
  DOCUMENT_WS: DurableObjectNamespace;
  ASSETS: Fetcher;
  [key: string]: unknown;
}

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      async fetch(
        request: IncomingRequest,
        env: Env,
        ctx: ExecutionContext
      ): Promise<Response> {
        const url = new URL(request.url);

        // The hosted, read-only MCP server (lib/hosted-mcp.ts). Its reads go to the API in-process,
        // so a share key never appears in a request URL that Cloudflare logs.
        if (url.pathname === "/mcp") {
          const ip = request.headers.get("cf-connecting-ip") || "unknown";
          return handleMcp(request, {
            allow: () => checkRateLimit(ip, "mcp", { max: 60, windowSec: 60 }).allowed,
            readApi: (path) =>
              handle(manifest, app, new Request(new URL(path, url.origin), {
                headers: { accept: "application/json", "cf-connecting-ip": ip, "user-agent": `mdshare-hosted-mcp/${MCP_VERSION}` },
              }) as IncomingRequest, env, ctx),
          });
        }

        // Intercept WebSocket upgrades before they reach Astro
        if (
          url.pathname.startsWith("/api/ws/") &&
          request.headers.get("Upgrade") === "websocket"
        ) {
          try {
            const id = url.pathname.split("/")[3];
            const key = url.searchParams.get("key");
            if (!id || !key) {
              return Response.json({ error: "Not found" }, { status: 404 });
            }

            const resolved = await resolveAccess(env.DB, key, id);
            if (!resolved || isExpired(resolved.docExpiresAt)) {
              return Response.json({ error: "Not found" }, { status: 404 });
            }

            const doBinding = env.DOCUMENT_WS;
            if (!doBinding) {
              return Response.json(
                { error: "WebSocket not available" },
                { status: 503 }
              );
            }

            const doId = doBinding.idFromName(id);
            const stub = doBinding.get(doId);
            return await stub.fetch(request.url, {
              headers: request.headers,
            });
          } catch (err) {
            // the document's live session restarted under the upgrade (a deploy, or
            // Cloudflare's maintenance): the browser reconnects, so ask it to
            if (isSessionGone(err)) {
              console.warn("WS upgrade: live session restarting, client will retry", {
                url: logUrl(request.url),
                colo: (request as IncomingRequest).cf?.colo,
                error: err instanceof Error ? err.message : String(err),
              });
              return new Response("Live sync is restarting. Reconnect.", {
                status: 503,
                headers: { "Retry-After": "1" },
              });
            }
            console.error("WS upgrade failed", {
              url: logUrl(request.url),
              colo: (request as IncomingRequest).cf?.colo,
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            throw err;
          }
        }

        // Everything else goes through Astro
        let response: Response;
        try {
          response = await handle(manifest, app, request, env, ctx);
        } catch (err) {
          console.error("Astro handler failed", {
            url: logUrl(request.url),
            method: request.method,
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : String(err),
          });
          throw err;
        }

        // Add security headers
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);

        if (url.pathname.startsWith("/d/")) {
          headers.set("X-Robots-Tag", "noindex, nofollow");
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      },

      async scheduled(
        _controller: ScheduledController,
        env: Env,
        _ctx: ExecutionContext
      ) {
        // Daily cron: expired documents, stale rate-limit windows, unused keyrings (lib/cleanup.ts)
        await runCleanup(env.DB, Date.now());
      },
    } satisfies ExportedHandler<Env>,
    DocumentWebSocket,
  };
}
