// Caps on user-supplied text, in characters. The API answers 400 over a cap (lib/request.ts);
// the browser trims to the same caps (lib/use-display-name.ts), so it never sends what the API refuses.
export const LIMITS = {
  comment: 10_000,
  authorName: 100,
  anchorText: 5_000,
  label: 200,
} as const;
