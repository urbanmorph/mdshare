/**
 * `prev` when `next` holds the same data, so a React state update with it is skipped.
 * Meant for the small JSON lists the poll returns (comments, viewers).
 */
export function keepIfUnchanged<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

// Browsers refuse a keepalive request whose body is over 64 KiB; leave room for headers.
const KEEPALIVE_LIMIT = 60 * 1024;

/** Whether a body this size can be sent with `fetch(..., { keepalive: true })`. */
export function fitsKeepalive(body: string): boolean {
  return new TextEncoder().encode(body).length < KEEPALIVE_LIMIT;
}

/** Header values must be ByteStrings, so the name is percent-encoded; the server decodes it. */
export function authorHeader(name: string): string {
  return encodeURIComponent(name);
}
