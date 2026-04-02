const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, X-Author, X-Edited-Via",
  "Access-Control-Max-Age": "86400",
};

export function corsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS };
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
