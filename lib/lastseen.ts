import { useState, useEffect, useCallback } from "react";
import { safeGet, safeSet, safeRemove } from "./storage.ts";
import { parseSqliteDate } from "./sqlite-date.ts";

// localStorage-only "last seen" tracker for the unread-comments badge.
// One key per document. Browser-scoped, no identity, no server state.

const KEY_PREFIX = "mdshare_lastseen_";
const MAX_KEYS = 50;

function key(docId: string) {
  return `${KEY_PREFIX}${docId}`;
}

/**
 * Seed lastseen to "now" if not yet set, so a first visit doesn't show
 * "all comments are unread" noise. Returns the value that ended up stored.
 */
export function seedLastSeenIfMissing(docId: string): string {
  const existing = safeGet(key(docId));
  if (existing) return existing;
  const now = new Date().toISOString();
  safeSet(key(docId), now);
  return now;
}

/**
 * Trim oldest lastseen entries past MAX_KEYS so localStorage doesn't grow
 * unbounded across hundreds of docs. Cheap to call on mount.
 */
export function pruneLastSeen() {
  const entries: [string, string][] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = k?.startsWith(KEY_PREFIX) ? localStorage.getItem(k) : null;
      if (k && v) entries.push([k, v]);
    }
  } catch {
    return; // storage blocked
  }
  if (entries.length <= MAX_KEYS) return;
  entries.sort((a, b) => a[1].localeCompare(b[1]));
  for (const [k] of entries.slice(0, entries.length - MAX_KEYS)) safeRemove(k);
}

interface CommentLike {
  created_at: string;
}

export function countUnread(lastSeen: string | null, comments: CommentLike[]): number {
  if (!lastSeen) return 0;
  const cutoff = Date.parse(lastSeen);
  return comments.filter((c) => parseSqliteDate(c.created_at) > cutoff).length;
}

/**
 * Returns the current unread count and a `markSeen()` function that advances
 * lastseen to "now". Listens to the `storage` event so cross-tab clears reflect
 * here in real-time.
 */
export function useUnreadCount(docId: string, comments: CommentLike[]) {
  const [lastSeen, setLastSeen] = useState(() => safeGet(key(docId)));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key(docId)) setLastSeen(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [docId]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    safeSet(key(docId), now);
    // The `storage` event does NOT fire in the same tab that wrote it, so
    // other tabs hear about it through the listener above; this tab updates
    // its own state directly.
    setLastSeen(now);
  }, [docId]);

  return { unreadCount: countUnread(lastSeen, comments), markSeen };
}
