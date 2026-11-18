const PREFIX = "Updated — ";

/**
 * Prefix the tab title with "Updated — " for a moment when someone else's edit arrives.
 * The base title is fixed when the flasher is made, so overlapping flashes always restore it.
 */
export function createTitleFlasher(target: { title: string }, ms = 3000) {
  const base = target.title.startsWith(PREFIX) ? target.title.slice(PREFIX.length) : target.title;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const restore = () => {
    clearTimeout(timer);
    timer = undefined;
    target.title = base;
  };
  return {
    flash() {
      clearTimeout(timer);
      target.title = PREFIX + base;
      timer = setTimeout(restore, ms);
    },
    /** Cancel any flash and put the base title back. */
    dispose: restore,
  };
}
