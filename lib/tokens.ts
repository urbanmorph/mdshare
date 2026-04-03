import { nanoid } from "nanoid";

const PERMISSION_PREFIXES = {
  admin: "adm_",
  edit: "edt_",
  view: "viw_",
  comment: "cmt_",
} as const;

export type Permission = keyof typeof PERMISSION_PREFIXES;

/**
 * Generate a token with a permission-indicating prefix.
 * Format: prefix + 32 chars of nanoid = ~36 char token
 */
export function generateToken(permission: Permission): string {
  return PERMISSION_PREFIXES[permission] + nanoid(32);
}

/**
 * SHA-256 hash a token for storage.
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Extract the first 8 characters of a token for efficient DB lookup.
 */
export function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

/**
 * Verify a token matches a stored hash.
 */
export async function verifyToken(
  token: string,
  storedHash: string
): Promise<boolean> {
  const hash = await hashToken(token);
  // Constant-time comparison to prevent timing attacks
  if (hash.length !== storedHash.length) return false;
  let result = 0;
  for (let i = 0; i < hash.length; i++) {
    result |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return result === 0;
}
