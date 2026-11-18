
import { useEffect, useEffectEvent, useState } from "react";
import { apiUrl } from "./api-url.ts";

export type WSStatus = "connecting" | "live" | "reconnecting";

interface UseDocumentWSOptions {
  documentId: string;
  tokenKey: string;
  /** Content saved by someone else, as the server broadcast it after a PUT or PATCH. */
  onContentUpdate: (content: string, contentHash: string) => void;
}

interface UseDocumentWSReturn {
  status: WSStatus;
  /**
   * How many times the socket has re-opened after a drop. The Durable Object keeps no
   * history, so a broadcast sent while disconnected is lost: catch up when this changes.
   */
  reconnects: number;
}

// Ping cadence. If a pong doesn't come back within the timeout, the socket is
// silently dead (laptop sleep/wake, Wi-Fi→cellular, an idle proxy/edge drop)
// and we force a close to trigger a reconnect. Without this, the status stays
// "live" forever on a half-open socket and updates quietly stop arriving.
const HEARTBEAT_INTERVAL_MS = 25000;
const PONG_TIMEOUT_MS = 10000;
const RECONNECT_DELAY_MS = 3000;

/**
 * Receives live document updates. The socket only listens: saves go through the REST API,
 * which broadcasts the sanitized content to every socket. A heartbeat detects dead sockets
 * and `reconnects` lets the caller resync on recovery.
 */
export function useDocumentWS({ documentId, tokenKey, onContentUpdate }: UseDocumentWSOptions): UseDocumentWSReturn {
  const [status, setStatus] = useState<WSStatus>("connecting");
  const [reconnects, setReconnects] = useState(0);
  const onUpdate = useEffectEvent((content: string, contentHash: string) => onContentUpdate(content, contentHash));

  useEffect(() => {
    // Set on unmount: the close() below must not schedule another connection.
    let disposed = false;
    let ws: WebSocket | null = null;
    let opened = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let pongTimer: ReturnType<typeof setTimeout> | undefined;
    const stopHeartbeat = () => {
      clearInterval(heartbeat);
      clearTimeout(pongTimer);
    };

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      try {
        ws = new WebSocket(apiUrl(`${protocol}//${window.location.host}/api/ws/${documentId}`, tokenKey));
      } catch {
        setStatus("reconnecting"); // WebSocket unavailable; the caller's poll carries on
        return;
      }
      const socket = ws;

      socket.onopen = () => {
        setStatus("live");
        stopHeartbeat();
        heartbeat = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          try {
            socket.send(JSON.stringify({ type: "ping" }));
          } catch {
            return;
          }
          clearTimeout(pongTimer);
          // No pong in time: the socket is dead. Closing triggers onclose, which reconnects.
          pongTimer = setTimeout(() => socket.close(), PONG_TIMEOUT_MS);
        }, HEARTBEAT_INTERVAL_MS);
        // Resync after a recovery, but not on the first connect: the page has fresh content.
        if (opened) setReconnects((n) => n + 1);
        opened = true;
      };

      socket.onmessage = (event) => {
        let data: { type?: string; content?: string; content_hash?: string };
        try {
          data = JSON.parse(event.data);
        } catch {
          return; // not JSON
        }
        if (data.type === "pong") clearTimeout(pongTimer);
        else if (data.type === "update" && typeof data.content === "string" && typeof data.content_hash === "string") {
          onUpdate(data.content, data.content_hash);
        }
      };

      socket.onclose = () => {
        stopHeartbeat();
        ws = null;
        if (disposed) return;
        setStatus("reconnecting");
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      disposed = true;
      stopHeartbeat();
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [documentId, tokenKey]);

  return { status, reconnects };
}
