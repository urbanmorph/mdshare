/**
 * Simple in-memory presence tracker.
 * Tracks who is viewing each document with a heartbeat model.
 * Entries expire after 45 seconds of no heartbeat.
 */

interface PresenceEntry {
  name: string;
  lastSeen: number;
}

// Map of documentId -> Map of sessionId -> PresenceEntry
const store = new Map<string, Map<string, PresenceEntry>>();

const EXPIRY_MS = 45_000; // 45 seconds

function cleanup(docId: string) {
  const doc = store.get(docId);
  if (!doc) return;
  const now = Date.now();
  for (const [sessionId, entry] of doc) {
    if (now - entry.lastSeen > EXPIRY_MS) doc.delete(sessionId);
  }
  if (doc.size === 0) store.delete(docId);
}

export function heartbeat(docId: string, sessionId: string, name: string) {
  if (!store.has(docId)) store.set(docId, new Map());
  store.get(docId)!.set(sessionId, { name, lastSeen: Date.now() });
  cleanup(docId);
}

export function getPresence(docId: string): { name: string }[] {
  cleanup(docId);
  const doc = store.get(docId);
  if (!doc) return [];
  // Deduplicate by name
  const seen = new Set<string>();
  const result: { name: string }[] = [];
  for (const entry of doc.values()) {
    if (!seen.has(entry.name)) {
      seen.add(entry.name);
      result.push({ name: entry.name });
    }
  }
  return result;
}
