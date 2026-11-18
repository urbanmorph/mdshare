/**
 * A short message for a failed API response: the server's `{ error }` when it sent one,
 * plain words for an expired or missing document, else `fallback`. Never throws, even when
 * the body is HTML from a proxy or empty.
 */
export async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const { error } = (await res.json()) as { error?: unknown };
    if (typeof error === "string" && error) return error;
  } catch {
    // not JSON
  }
  if (res.status === 410) return "This document has expired.";
  if (res.status === 404) return "Not found. It may have been deleted.";
  if (res.status === 429) return "Too many requests. Wait a minute and try again.";
  return fallback;
}
