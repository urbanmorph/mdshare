// The live-sync WebSocket's failure handling, shared by the upgrade route (src/worker.ts)
// and the document's Durable Object (worker/document-ws.ts).

const SESSION_GONE = /network connection lost|durable object instance is no longer active|durable object reset/i;

/**
 * Whether an error means the document's live session (its Durable Object) went away under
 * the request: Cloudflare restarted it for a deploy or its own maintenance. The browser
 * reconnects on its own, so the right answer is a retry, not an exception.
 */
export function isSessionGone(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const flags = err as Error & { retryable?: boolean; overloaded?: boolean };
  return flags.retryable === true || flags.overloaded === true || SESSION_GONE.test(err.message);
}

/** A URL fit for a log: origin and path, never the query, which carries the share key. */
export function logUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return "(unparseable url)";
  }
}

const OPEN = 1;   // WebSocket.OPEN, also outside the Workers runtime

/**
 * Sends `message` to every open socket but `except`. A socket closing at that moment throws
 * on send; it is skipped, as its own close follows. Returns how many were sent.
 */
export function sendAll(
  sockets: Iterable<{ readyState: number; send(m: string): void }>,
  message: string,
  except?: unknown,
): number {
  let sent = 0;
  for (const s of sockets) {
    if (s === except || s.readyState !== OPEN) continue;
    try {
      s.send(message);
      sent++;
    } catch {
      /* closing; its close event follows */
    }
  }
  return sent;
}
