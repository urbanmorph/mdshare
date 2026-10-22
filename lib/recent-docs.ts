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

/** Pure upsert (testable): newest first, deduped by doc+key, capped per kind. */
export function addRecentDoc(
  list: RecentDoc[],
  doc: Omit<RecentDoc, "visitedAt">,
  now: number
): RecentDoc[] {
  const next = [
    { ...doc, visitedAt: now },
    ...list.filter((d) => !(d.id === doc.id && d.key === doc.key)),
  ];
  let admin = 0;
  let other = 0;
  return next.filter((d) =>
    d.permission === "admin" ? ++admin <= MAX_ADMIN : ++other <= MAX_RECENT
  );
}

export function saveRecentDoc(doc: Omit<RecentDoc, "visitedAt">) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(addRecentDoc(getRecentDocsSnapshot(), doc, Date.now()))
    );
  } catch {
    // localStorage may be unavailable (private mode, quota); silently no-op.
  }
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
  return () => window.removeEventListener("storage", onChange);
}
