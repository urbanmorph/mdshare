import type { APIRoute } from "astro";
import { nanoid } from "nanoid";
import { getDB, rateLimitSalt } from "../../../lib/db";
import { generateToken, hashToken, tokenPrefix } from "../../../lib/tokens";
import { encryptToken } from "../../../lib/token-crypto";
import { sanitizeMarkdown, contentHash, validateIsText, sanitizeTitle, titleFrom } from "../../../lib/sanitize";
import { checkRateLimit, checkDurableRateLimit, rateLimitResponse } from "../../../lib/rate-limit";
import { incrementStatStatement } from "../../../lib/stats";
import { decodeHeader } from "../../../lib/request";
import { documentSource } from "../../../lib/document-source";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const t0 = Date.now();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const db = getDB();

  // Cheap first line: per-isolate burst guard (no DB hit).
  const burstLimit = checkRateLimit(ip, "create", { max: 10, windowSec: 60 });
  if (!burstLimit.allowed) return rateLimitResponse(burstLimit);

  // Real backstop: durable, globally-coordinated daily cap. The in-memory
  // limiter above is per-isolate, so it never held across Cloudflare's edge —
  // a spam bot created 133 docs in a day past a nominal 50/day cap. This one
  // is D1-backed, so 50/day/IP actually holds.
  const dailyLimit = await checkDurableRateLimit(db, ip, "create-daily", { max: 50, windowSec: 86400 }, rateLimitSalt());
  if (!dailyLimit.allowed) {
    return Response.json(
      { error: "Daily document creation limit reached (50 per day). Try again tomorrow." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((dailyLimit.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  let rawContent: string;
  let fileTitle = "";

  const contentType = request.headers.get("content-type") || "";
  const userAgent = request.headers.get("user-agent") || "";
  const origin = request.headers.get("origin") || "";
  const xSource = request.headers.get("x-source") || "";

  const source = documentSource({ contentType, userAgent, origin, xSource });

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const rawBytes = new Uint8Array(await file.arrayBuffer());
    try {
      validateIsText(rawBytes);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 });
    }

    rawContent = new TextDecoder("utf-8").decode(rawBytes);
    fileTitle = sanitizeTitle(file.name.replace(/\.mdx?$/, ""));
  } else {
    rawContent = await request.text();
    if (!rawContent.trim()) {
      return Response.json({ error: "Empty content" }, { status: 400 });
    }
  }

  const tSanitize = Date.now();
  let content: string;
  try {
    content = await sanitizeMarkdown(rawContent);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
  const hash = await contentHash(content);
  const sanitizeMs = Date.now() - tSanitize;

  // The title: the sanitized content's H1; else an integration's X-Title hint (percent-encoded
  // for safe transport of unicode); else the uploaded file's name.
  const title =
    titleFrom(content) || sanitizeTitle(decodeHeader(request.headers.get("x-title")) ?? "") || fileTitle || "Untitled";

  const docId = nanoid(10);
  const adminToken = generateToken("admin");
  const adminTokenHash = await hashToken(adminToken);
  const adminPrefix = tokenPrefix(adminToken);
  const adminTokenStored = await encryptToken(adminToken);
  const linkId = nanoid(16);

  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const tDb = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO documents (id, title, content, content_hash, expires_at, source)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(docId, title, content, hash, expiresAt, source),
    db
      .prepare(
        `INSERT INTO links (id, document_id, token_prefix, token_hash, permission, label, token)
         VALUES (?, ?, ?, ?, 'admin', 'admin', ?)`
      )
      .bind(linkId, docId, adminPrefix, adminTokenHash, adminTokenStored),
    incrementStatStatement(db, "documents_created"),
  ]);
  const dbMs = Date.now() - tDb;

  const baseUrl = new URL(request.url).origin;
  const totalMs = Date.now() - t0;

  return Response.json(
    {
      document_id: docId,
      admin_key: adminToken,
      admin_url: `${baseUrl}/d/${docId}?key=${adminToken}`,
      expires_at: expiresAt,
      processing_ms: totalMs,
      note: "Document expires in 90 days. Share links may have their own expiry.",
    },
    {
      status: 201,
      headers: {
        "Server-Timing": `sanitize;dur=${sanitizeMs}, db;dur=${dbMs}, total;dur=${totalMs}`,
      },
    }
  );
};
