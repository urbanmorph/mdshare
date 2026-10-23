// "Recent documents" on all your devices. Admin keys are the only way back to a
// document you own (no accounts), and they lived in one browser's storage. This
// syncs the list end to end encrypted (lib/keyring.ts), through mdshare's own
// keyring server (lib/keyrings.ts), opt-in, with a private sync link or a passkey.
import {
  deriveKeys, keyringHttp, newSecret, sealJson, syncDoc, SyncGone, unsealJson,
  type KeyringServer,
} from "./keyring.ts";
import { createPasskeyPrf, passkeyPrf, recoverSecret, storeWrappedSecret, type PasskeyHandle } from "./passkey.ts";
import { capRecent, readRecentDocs, writeRecentDocs, type RecentDoc } from "./recent-docs.ts";

const STATE_KEY = "mdshare_keyring";

export interface SyncState {
  secret: string;
  synced_at?: string;
  passkey?: PasskeyHandle;
}

/** Each document+key once, with its latest visit (and title), newest first, capped as usual. */
export function mergeRecent(a: RecentDoc[], b: RecentDoc[]): RecentDoc[] {
  const latest = new Map<string, RecentDoc>();
  for (const d of [...a, ...b]) {
    const k = `${d.id}\n${d.key}`;
    const seen = latest.get(k);
    if (!seen || d.visitedAt > seen.visitedAt) latest.set(k, d);
  }
  return capRecent([...latest.values()].sort((x, y) => y.visitedAt - x.visitedAt));
}

const codec = {
  seal: (encKey: CryptoKey, docs: RecentDoc[]) => sealJson(encKey, { v: 1, recent: docs }),
  async unseal(encKey: CryptoKey, blob: string): Promise<RecentDoc[]> {
    const doc = await unsealJson<{ v: number; recent: RecentDoc[] }>(encKey, blob);
    if (doc.v !== 1 || !Array.isArray(doc.recent)) throw new Error("unknown keyring format");
    return doc.recent;
  },
  merge: mergeRecent,
};

export interface RecentSyncDeps {
  api: KeyringServer;
  storage: Storage;
  /** The passkey's PRF bytes: a new passkey, or an existing one (shows the OS sheet). */
  passkey: { create(): Promise<Uint8Array>; get(): Promise<Uint8Array> };
}

export function createRecentSync({ api, storage, passkey }: RecentSyncDeps) {
  const state = (): SyncState | null => {
    try {
      return JSON.parse(storage.getItem(STATE_KEY) || "null") as SyncState | null;
    } catch {
      return null;
    }
  };
  const saveState = (s: SyncState | null) => {
    try {
      if (s) storage.setItem(STATE_KEY, JSON.stringify(s));
      else storage.removeItem(STATE_KEY);
    } catch {
      // best effort
    }
  };
  const list = () => readRecentDocs(storage);

  // One round: pull, merge, push, then keep the merged list here.
  async function syncNow(): Promise<void> {
    const st = state();
    if (!st) return;
    try {
      const keys = await deriveKeys(st.secret);
      const out = await syncDoc(keys, list(), api, codec, { joined: !!st.synced_at });
      writeRecentDocs(mergeRecent(list(), out.value), storage);
      saveState({ ...st, synced_at: new Date().toISOString() });
    } catch (e) {
      if (e instanceof SyncGone) saveState(null); // turned off elsewhere: stop here too
      throw e;
    }
  }

  return {
    state,
    list,
    syncNow,
    /** This device's sync link (keep private), or null when sync is off. */
    link: (origin: string) => {
      const st = state();
      return st ? `${origin}/#sync=${st.secret}` : null;
    },
    async turnOn() {
      saveState({ secret: newSecret() });
      await syncNow();
    },
    /** Opened a sync link here: adopt its secret and merge both lists. */
    async join(secret: string) {
      saveState({ secret });
      await syncNow();
    },
    /** Deletes the synced copy and the passkey's, on every device. */
    async turnOff() {
      const st = state();
      if (!st) return;
      const keys = await deriveKeys(st.secret);
      await api.delete(keys.id, keys.writeKey);
      if (st.passkey) await api.delete(st.passkey.id, st.passkey.writeKey);
      saveState(null);
    },
    async addPasskey() {
      const st = state();
      if (!st) throw new Error("turn on sync first");
      saveState({ ...st, passkey: await storeWrappedSecret(await passkey.create(), st.secret, api) });
    },
    /** A new device: the passkey recovers the secret. */
    async unlockWithPasskey() {
      const found = await recoverSecret(await passkey.get(), api);
      if (!found) throw new Error("no synced copy for this passkey (sync may have been turned off)");
      saveState({ secret: found.secret, passkey: found.handle });
      await syncNow();
    },
  };
}

export type RecentSync = ReturnType<typeof createRecentSync>;

// ---- In the browser ----------------------------------------------------------

/** The browser's sync: mdshare's own keyring API, localStorage, real passkeys. */
export function browserRecentSync(): RecentSync {
  return createRecentSync({
    api: keyringHttp("/api"),
    storage: localStorage,
    passkey: { create: createPasskeyPrf, get: passkeyPrf },
  });
}

/** After a visit is saved: sync it in the background if sync is on (failures wait for the next one). */
export function syncRecentSoon(): void {
  try {
    if (!localStorage.getItem(STATE_KEY)) return;
  } catch {
    return;
  }
  browserRecentSync().syncNow().catch(() => {});
}

/** What went wrong, in plain words: a cancelled passkey, a lost connection, or the reason given. */
export function syncErrorText(e: unknown, online = true): string {
  if ((e as Error)?.name === "NotAllowedError") return "Passkey cancelled.";
  if (!online || (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)))
    return "Couldn't reach mdshare. Check your connection and try again.";
  return (e as Error)?.message || "Something went wrong.";
}
