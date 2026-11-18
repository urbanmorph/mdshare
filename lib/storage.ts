// localStorage that never throws: it is missing during SSR and throws when the browser blocks
// site data (Safari with cookies off, some embedded webviews). Callers get null or the fallback.
const store = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function safeGet(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    // storage blocked or full: the value just isn't remembered
  }
}

export function safeRemove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // storage blocked
  }
}

/** The stored JSON value, or `fallback` when it is missing, unreadable or not JSON. */
export function safeGetJson<T>(key: string, fallback: T): T {
  const raw = safeGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
