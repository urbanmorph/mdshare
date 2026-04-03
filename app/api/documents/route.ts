import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { getDB } from "@/lib/db";
import { generateToken, hashToken, tokenPrefix } from "@/lib/tokens";
import { sanitizeMarkdown, contentHash, validateIsText } from "@/lib/sanitize";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/documents — Create a new document.
 * Accepts: text/markdown body or multipart form-data with file field.
 * Returns: admin key + admin URL.
 * Rate limited: 10 creates per minute, 50 per day per IP.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";

  // Per-minute burst limit
  const burstLimit = checkRateLimit(ip, "create", { max: 10, windowSec: 60 });
  if (!burstLimit.allowed) return rateLimitResponse(burstLimit);

  // Daily budget
  const dailyLimit = checkRateLimit(ip, "create-daily", { max: 50, windowSec: 86400 });
  if (!dailyLimit.allowed) {
    return Response.json(
      { error: "Daily document creation limit reached (50 per day). Try again tomorrow." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((dailyLimit.resetAt - Date.now()) / 1000)) } }
    );
  }

  const db = getDB();
  let rawContent: string;
  let title = "Untitled";

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate raw bytes BEFORE text conversion
    const rawBytes = new Uint8Array(await file.arrayBuffer());
    try {
      validateIsText(rawBytes);
    } catch (err) {
      return Response.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }

    rawContent = new TextDecoder("utf-8").decode(rawBytes);
    title = file.name.replace(/\.mdx?$/, "") || "Untitled";
  } else {
    rawContent = await request.text();
    if (!rawContent.trim()) {
      return Response.json(
        { error: "Empty content" },
        { status: 400 }
      );
    }
  }

  // Extract title from first heading if present
  const headingMatch = rawContent.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    title = headingMatch[1].trim();
  }

  // Sanitize content (also runs validateIsText for non-multipart uploads)
  let content: string;
  try {
    content = await sanitizeMarkdown(rawContent);
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
  const hash = await contentHash(content);

  const docId = nanoid(10);
  const adminToken = generateToken("admin");
  const adminTokenHash = await hashToken(adminToken);
  const adminPrefix = tokenPrefix(adminToken);
  const linkId = nanoid(16);

  // Default 90-day expiry
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO documents (id, title, content, content_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(docId, title, content, hash, expiresAt)
    .run();

  // Insert admin link (store raw token so admin can always retrieve URLs)
  await db
    .prepare(
      `INSERT INTO links (id, document_id, token_prefix, token_hash, permission, label, token)
       VALUES (?, ?, ?, ?, 'admin', 'admin', ?)`
    )
    .bind(linkId, docId, adminPrefix, adminTokenHash, adminToken)
    .run();

  const baseUrl = new URL(request.url).origin;

  return Response.json(
    {
      document_id: docId,
      admin_key: adminToken,
      admin_url: `${baseUrl}/d/${docId}?key=${adminToken}`,
      expires_at: expiresAt,
      note: "Document expires in 90 days. Share links may have their own expiry.",
    },
    { status: 201 }
  );
}
