// The server side of "Recent documents" sync (lib/keyring.ts is the browser
// side). It stores an encrypted blob per keyring id and can't read it or tell
// whose it is. The write key is kept only as a SHA-256 hash and gates update and
// delete. A write against an older version is a 409 with the current blob, so
// the device merges and retries. Unused for 12 months = deleted by the daily cron.
// Same rules as collect's /keyrings (geodata), on mdshare's own database.

const KEYRING_ID = /^[0-9a-f]{32}$/;
const KEYRING_KEY = /^[A-Za-z0-9_-]{43}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const KEYRING_MAX = 262_144;
export const KEYRING_TTL_MS = 365 * 86_400_000;

export interface KeyringRow {
  id: string;
  write_hash: string;
  blob: string;
  updated_at: string;
}

/** Storage for keyrings; D1 in production (d1KeyringStore), a Map in tests. */
export interface KeyringStore {
  get(id: string): Promise<KeyringRow | null>;
  /** Marks it used, so it outlives the 12-month purge. */
  touch(id: string): Promise<void>;
  insert(id: string, writeHash: string, blob: string): Promise<string>;
  /** Replaces the blob only if it is still at `base`; null when another write came first. */
  update(id: string, blob: string, base: string): Promise<string | null>;
  delete(id: string): Promise<void>;
}

const err = (status: number, error: string) => Response.json({ error }, { status });

async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time hex compare (both are SHA-256 hex, same length when valid).
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The write key from `Authorization: Bearer …`, if well formed. */
export function writeKeyFrom(request: Request): string | null {
  const m = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  return m && KEYRING_KEY.test(m[1]) ? m[1] : null;
}

export async function getKeyring(store: KeyringStore, id: string): Promise<Response> {
  if (!KEYRING_ID.test(id)) return err(400, "bad keyring id");
  const row = await store.get(id);
  if (!row) return err(404, "not found");
  await store.touch(id);
  return Response.json({ blob: row.blob, updated_at: row.updated_at });
}

export async function putKeyring(
  store: KeyringStore,
  id: string,
  writeKey: string | null,
  body: { blob?: unknown; base?: unknown } | null
): Promise<Response> {
  if (!KEYRING_ID.test(id)) return err(400, "bad keyring id");
  if (!writeKey) return err(401, "unauthorised");
  const blob = body?.blob;
  if (typeof blob !== "string" || !blob) return err(400, "blob required");
  if (blob.length > KEYRING_MAX) return err(413, "keyring too large");
  if (!B64URL.test(blob)) return err(400, "blob must be base64url");
  const base = typeof body?.base === "string" ? body.base : null;

  const hash = await hashKey(writeKey);
  const row = await store.get(id);
  if (!row) {
    // Writing against a version that no longer exists = sync was turned off
    // (or the keyring expired) elsewhere: tell the device to stop, don't revive it.
    if (base) return err(410, "this synced copy was deleted");
    return Response.json({ updated_at: await store.insert(id, hash, blob) });
  }
  if (!sameHash(hash, row.write_hash)) return err(401, "unauthorised");
  const updated = base ? await store.update(id, blob, base) : null;
  if (!updated) return Response.json({ blob: row.blob, updated_at: row.updated_at }, { status: 409 });
  return Response.json({ updated_at: updated });
}

export async function deleteKeyring(store: KeyringStore, id: string, writeKey: string | null): Promise<Response> {
  if (!KEYRING_ID.test(id)) return err(400, "bad keyring id");
  const row = writeKey ? await store.get(id) : null;
  if (!writeKey || (row && !sameHash(await hashKey(writeKey), row.write_hash))) return err(401, "unauthorised");
  if (row) await store.delete(id);
  return Response.json({ deleted: true });
}

export function d1KeyringStore(db: D1Database): KeyringStore {
  const now = () => new Date().toISOString();
  return {
    get: (id) =>
      db.prepare("SELECT id, write_hash, blob, updated_at FROM keyrings WHERE id = ?").bind(id).first<KeyringRow>(),
    async touch(id) {
      await db.prepare("UPDATE keyrings SET used_at = ? WHERE id = ?").bind(now(), id).run();
    },
    async insert(id, writeHash, blob) {
      const t = now();
      await db
        .prepare("INSERT INTO keyrings (id, write_hash, blob, created_at, updated_at, used_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, writeHash, blob, t, t, t)
        .run();
      return t;
    },
    async update(id, blob, base) {
      const t = now();
      const res = await db
        .prepare("UPDATE keyrings SET blob = ?, updated_at = ?, used_at = ? WHERE id = ? AND updated_at = ?")
        .bind(blob, t, t, id, base)
        .run();
      return res.meta.changes ? t : null;
    },
    async delete(id) {
      await db.prepare("DELETE FROM keyrings WHERE id = ?").bind(id).run();
    },
  };
}
