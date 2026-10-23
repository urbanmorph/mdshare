const STORAGE_KEY = "mdshare_recent";
// Visits with view/comment/edit keys are a convenience, so only the latest few
// are kept. Admin keys are the only way back to a document you own (no
// accounts), so they never get pushed out by other visits; the separate,
// generous cap only keeps localStorage bounded.
export const MAX_RECENT = 10;
export const MAX_ADMIN = 200;

export interface RecentDoc {
  id: string;
  title: string;
  key: string;
  permission: string;
  visitedAt: number;
}

/** Keeps the newest MAX_ADMIN admin entries and MAX_RECENT others (list is newest first). */
export function capRecent(list: RecentDoc[]): RecentDoc[] {
  let admin = 0;
  let other = 0;
  return list.filter((d) =>
    d.permission === "admin" ? ++admin <= MAX_ADMIN : ++other <= MAX_RECENT
  );
}

/** Pure upsert (testable): newest first, deduped by doc+key, capped per kind. */
export function addRecentDoc(
  list: RecentDoc[],
  doc: Omit<RecentDoc, "visitedAt">,
  now: number
): RecentDoc[] {
  return capRecent([
    { ...doc, visitedAt: now },
    ...list.filter((d) => !(d.id === doc.id && d.key === doc.key)),
  ]);
}

/** Fired on this page when the list changes here (the "storage" event covers other tabs). */
export const RECENT_CHANGED = "mdshare:recent-changed";

export function readRecentDocs(storage: Storage = localStorage): RecentDoc[] {
  try {
    const list = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(list) ? (list as RecentDoc[]) : [];
  } catch {
    return [];
  }
}

export function writeRecentDocs(list: RecentDoc[], storage: Storage = localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage may be unavailable (private mode, quota); silently no-op.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RECENT_CHANGED));
}

export function saveRecentDoc(doc: Omit<RecentDoc, "visitedAt">) {
  writeRecentDocs(addRecentDoc(readRecentDocs(), doc, Date.now()));
}

// Store adapter for React's useSyncExternalStore: the snapshot must keep the
// same reference until the stored value changes, and the server renders none.
let cachedRaw: string | null = null;
let cached: RecentDoc[] = [];
const NONE: RecentDoc[] = [];

export function getRecentDocsSnapshot(): RecentDoc[] {
  let raw = "[]";
  try {
    raw = localStorage.getItem(STORAGE_KEY) || "[]";
  } catch {
    // unavailable storage reads as empty
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cached = JSON.parse(raw) as RecentDoc[];
    } catch {
      cached = [];
    }
  }
  return cached;
}

export const getServerRecentDocs = (): RecentDoc[] => NONE;

export function subscribeRecentDocs(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(RECENT_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RECENT_CHANGED, onChange);
  };
}
