// Security headers for every response. src/worker.ts sets them on dynamic responses;
// public/_headers repeats them for static files (lib/security-headers.test.ts keeps the two equal).
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; " +
    "connect-src 'self' wss: https:; frame-ancestors 'none'",
};
