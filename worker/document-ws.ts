import { DurableObject } from "cloudflare:workers";
import { isSessionGone, logUrl, sendAll } from "../lib/ws-errors";

/**
 * Durable Object that manages WebSocket connections for a single document.
 * Uses the Hibernation API to sleep when no clients are connected (free tier friendly).
 */
export class DocumentWebSocket extends DurableObject {
  private connections = new Set<WebSocket>();

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

      const permission = url.searchParams.get("permission") || "view";

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      // Accept with hibernation
      this.ctx.acceptWebSocket(server, [permission]);
      this.connections.add(server);

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
   * Called when a WebSocket receives a message.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message);

      if (data.type === "update") {
        // Only edit/admin participants may push content changes. The permission
        // was tagged onto this socket at accept time (see fetch()); without this
        // check a view/comment-only token could broadcast arbitrary content to
        // every other connected client. Default-deny if the tag is missing.
        const [permission] = this.ctx.getTags(ws);
        if (permission !== "edit" && permission !== "admin") return;

        // Broadcast to all OTHER connected clients
        sendAll(this.ctx.getWebSockets(), message, ws);
      }

      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  /**
   * Called when a WebSocket is closed.
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.connections.delete(ws);
    try {
      this.broadcastPresence();
    } catch (err) {
      // a close on a session Cloudflare is already retiring: the others reconnect anyway
      if (!isSessionGone(err)) throw err;
    }
  }

  /**
   * Called when a WebSocket errors.
   */
  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.connections.delete(ws);
  }

  private broadcastPresence() {
    const count = this.ctx.getWebSockets().length;
    sendAll(this.ctx.getWebSockets(), JSON.stringify({ type: "presence", count }));
  }
}
