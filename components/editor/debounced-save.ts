export interface SaveOptions {
  /** Send with fetch keepalive, so the save finishes after the tab is hidden or closed. */
  keepalive?: boolean;
}

/**
 * Saves the editor's markdown `delayMs` after the last change, or at once on flush()
 * (Cmd+S, the tab being hidden or closed).
 */
export function createDebouncedSave(
  read: () => string,
  save: (markdown: string, opts?: SaveOptions) => void,
  delayMs: number
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const flush = (opts?: SaveOptions) => {
    if (!timer) return;
    cancel();
    save(read(), opts);
  };
  return {
    schedule() {
      cancel();
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel,
    /** Whether there are edits not yet sent. */
    pending: () => timer !== null,
  };
}
