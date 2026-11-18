import { DurableObject } from "cloudflare:workers";
import { logUrl, sendAll } from "../lib/ws-errors";

/**
 * Durable Object that fans a document's saved content out to its open WebSocket connections.
 * Uses the Hibernation API to sleep when no clients are connected (free tier friendly).
 *
 * Content only ever comes from the server: PUT/PATCH save and sanitize it, then post it to
 * /broadcast (lib/broadcast.ts). Clients send nothing but pings; anything else is ignored.
 */
export class DocumentWebSocket extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);

      // Non-WebSocket: broadcast an update to all connected clients (called by API routes)
      if (request.headers.get("Upgrade") !== "websocket") {
        if (request.method === "POST" && url.pathname.endsWith("/broadcast")) {
          sendAll(this.ctx.getWebSockets(), await request.text());
          return new Response("ok");
        }
        return new Response("Expected WebSocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      // Accept with hibernation
      this.ctx.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    } catch (err) {
      console.error("DocumentWebSocket.fetch failed", {
        url: logUrl(request.url),
        method: request.method,
        upgrade: request.headers.get("Upgrade"),
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
      throw err;
    }
  }

  /**
   * Called when a WebSocket receives a message: a keep-alive ping gets a pong.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    try {
      if (JSON.parse(message)?.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    } catch {
      // Ignore invalid JSON
    }
  }
}
