import { env } from "cloudflare:workers";

// Encryption-at-rest for the stored raw share tokens (the `links.token` column).
//
// A request is authenticated against `token_hash`, never against this column —
// it exists only so an admin can retrieve share URLs later (list_links) and so
// the create response can echo the URL. Storing it in cleartext meant a
// database-only leak handed an attacker every working token. Encrypting it with
// AES-GCM under the TOKEN_ENC_KEY Worker secret means a DB dump alone is useless:
// decrypting also needs the key, which lives only in the Worker's environment.
//
// Stored format: "v1:<base64 iv>:<base64 ciphertext+tag>". Legacy rows written
// before this change have no prefix and are passed through untouched, so reads
// keep working during the one-time backfill (see scripts/backfill-token-encryption.mjs).
//
// Fail-open by design: if the key is absent (misconfiguration), encryptToken
// returns the plaintext rather than breaking document/link creation — the same
// behaviour as before this change — and warns once so the gap is visible.

const PREFIX = "v1:";

function encKey(): string | null {
  const k = (env as { TOKEN_ENC_KEY?: string }).TOKEN_ENC_KEY;
  return k && k.length > 0 ? k : null;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64(keyB64), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt a raw token for storage. Fail-open: no key → returns plaintext. */
export async function encryptToken(plaintext: string): Promise<string> {
  const km = encKey();
  if (!km) {
    console.warn("TOKEN_ENC_KEY not set — storing share token unencrypted");
    return plaintext;
  }
  const key = await importKey(km);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext))
  );
  return `${PREFIX}${toB64(iv)}:${toB64(ct)}`;
}

/**
 * Decrypt a stored token back to its raw form for display. Legacy plaintext
 * (no prefix) is returned as-is. Returns null when a ciphertext can't be
 * decrypted (missing/rotated key, tampered value) so callers can omit the URL.
 */
export async function decryptToken(stored: string | null): Promise<string | null> {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext (pre-backfill)
  const km = encKey();
  if (!km) return null;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 2) return null;
  try {
    const key = await importKey(km);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(parts[0]) },
      key,
      fromB64(parts[1])
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
