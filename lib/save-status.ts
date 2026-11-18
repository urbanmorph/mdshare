/** What the status bar says about this tab's edits, and the colour of its dot. */
const TONE = {
  Ready: "ok",
  "Saving...": "busy",
  Saved: "ok",
  "No changes": "ok",
  Updated: "busy",
  "Save failed": "error",
  "Not saved: newer version loaded": "error",
} as const;

export type SaveStatus = keyof typeof TONE;
export type StatusTone = (typeof TONE)[SaveStatus];

/** Green, yellow or red. */
export function statusTone(status: SaveStatus): StatusTone {
  return TONE[status];
}

/** Passing messages go back to "Ready" after a moment; errors stay until the next save. */
export function settlesToReady(status: SaveStatus): boolean {
  return status === "Saved" || status === "No changes" || status === "Updated";
}
