import { useCallback, useEffect, useRef, useState } from "react";

// The copy buttons' "Copied!" flash: one timer per hook, cleared on unmount, and a
// clipboard that refuses (insecure context, denied permission) shows "Copy failed".

export interface CopyStatus {
  id: string;
  ok: boolean;
}

type Clipboard = { writeText(text: string): Promise<void> } | undefined;

/** Writes to the clipboard; never rejects. */
export async function writeClipboard(
  text: string,
  clipboard: Clipboard = globalThis.navigator?.clipboard,
): Promise<boolean> {
  try {
    if (!clipboard) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

interface Clock<T> {
  set(fn: () => void, ms: number): T;
  clear(id: T | undefined): void;
}

const realClock: Clock<ReturnType<typeof setTimeout>> = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
};

/** The hook's logic without React: report each copy, clear it after `ms`, stop on dispose. */
export function createCopier<T>(
  write: (text: string) => Promise<boolean>,
  onChange: (status: CopyStatus | null) => void,
  ms: number,
  clock: Clock<T>,
) {
  let timer: T | undefined;
  let disposed = false;
  return {
    async copy(text: string, id: string): Promise<boolean> {
      const ok = await write(text);
      if (disposed) return ok;
      clock.clear(timer);
      onChange({ id, ok });
      timer = clock.set(() => onChange(null), ms);
      return ok;
    },
    dispose() {
      disposed = true;
      clock.clear(timer);
    },
  };
}

/**
 * `copy(text, id)` copies and flashes `id`; `label(id, idle)` is the button text:
 * "Copied!", "Copy failed", or `idle`. `copied(id)` is true while the flash shows.
 */
export function useCopy(ms = 2000) {
  const [status, setStatus] = useState<CopyStatus | null>(null);
  const copier = useRef<ReturnType<typeof createCopier> | null>(null);

  useEffect(() => {
    const c = createCopier((text) => writeClipboard(text), setStatus, ms, realClock);
    copier.current = c;
    return () => c.dispose();
  }, [ms]);

  const copy = useCallback(
    (text: string, id = "") => copier.current?.copy(text, id) ?? Promise.resolve(false),
    [],
  );
  const copied = (id = "") => status?.id === id && status.ok;
  const label = (id: string, idle: string) =>
    status?.id !== id ? idle : status.ok ? "Copied!" : "Copy failed";

  return { copy, copied, label };
}
