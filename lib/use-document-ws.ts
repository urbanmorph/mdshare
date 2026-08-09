
import { useEffect, useRef, useState, useCallback } from "react";

export type WSStatus = "connecting" | "live" | "reconnecting";

interface UseDocumentWSOptions {
  documentId: string;
  tokenKey: string;
  onContentUpdate: (content: string, contentHash: string) => void;
  /**
   * Called each time the socket re-opens after a drop (never on the first
   * connect). Use it to fetch once and catch up on anything missed while
   * disconnected — the Durable Object is a pure relay with no replay, so a
   * broadcast that fired while we were away is gone otherwise.
   */
  onReconnect?: () => void;
  enabled: boolean;
}

interface UseDocumentWSReturn {
  broadcastUpdate: (content: string, contentHash: string) => void;
  presenceCount: number;
  connected: boolean;
  status: WSStatus;
}

// Ping cadence. If a pong doesn't come back within the timeout, the socket is
// silently dead (laptop sleep/wake, Wi-Fi→cellular, an idle proxy/edge drop)
// and we force a close to trigger a reconnect. Without this, `connected` stays
// true forever on a half-open socket and updates quietly stop arriving.
const HEARTBEAT_INTERVAL_MS = 25000;
const PONG_TIMEOUT_MS = 10000;
const RECONNECT_DELAY_MS = 3000;

/**
 * WebSocket hook for real-time document updates.
 *
 * The socket is the only steady-state content path. A heartbeat detects dead
 * sockets and a reconnect callback lets the caller resync on recovery, so we
 * don't need a permanent background content poll to stay correct.
 */
export function useDocumentWS({
  documentId,
  tokenKey,
  onContentUpdate,
  onReconnect,
  enabled,
}: UseDocumentWSOptions): UseDocumentWSReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasConnectedRef = useRef(false);
  const [presenceCount, setPresenceCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<WSStatus>("connecting");
  const onContentUpdateRef = useRef(onContentUpdate);
  onContentUpdateRef.current = onContentUpdate;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const clearTimers = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled) return;

    // Build WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws/${documentId}?key=${tokenKey}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setStatus("live");

        // Start the heartbeat.
        clearTimers();
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch {
            return;
          }
          if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
          pongTimeoutRef.current = setTimeout(() => {
            // No pong in time — the socket is dead. Closing triggers onclose,
            // which schedules the reconnect.
            try {
              ws.close();
            } catch {
              /* already closing */
            }
          }, PONG_TIMEOUT_MS);
        }, HEARTBEAT_INTERVAL_MS);

        // Resync after a recovery, but not on the first-ever connect — the page
        // loaded with fresh SSR content and the caller's initial poll already ran.
        if (hasConnectedRef.current) {
          onReconnectRef.current?.();
        } else {
          hasConnectedRef.current = true;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "pong") {
            if (pongTimeoutRef.current) {
              clearTimeout(pongTimeoutRef.current);
              pongTimeoutRef.current = null;
            }
          }

          if (data.type === "update") {
            onContentUpdateRef.current(data.content, data.content_hash);
          }

          if (data.type === "presence") {
            setPresenceCount(data.count);
          }
        } catch {
          // Ignore invalid messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setStatus("reconnecting");
        clearTimers();
        wsRef.current = null;
        // Reconnect after a short delay
        reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available (e.g., local dev without DO support)
      setConnected(false);
      setStatus("reconnecting");
    }
  }, [documentId, tokenKey, enabled, clearTimers]);

  useEffect(() => {
    connect();

    return () => {
      clearTimers();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect, clearTimers]);

  const broadcastUpdate = useCallback(
    (content: string, contentHash: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "update",
            content,
            content_hash: contentHash,
          })
        );
      }
    },
    []
  );

  return { broadcastUpdate, presenceCount, connected, status };
}
