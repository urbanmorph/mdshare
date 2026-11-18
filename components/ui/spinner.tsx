import { useState, useEffect } from "react";

const UPLOAD_VERBS = [
  "Sanitizing markdown...",
  "Checking for gremlins...",
  "Generating share links...",
  "Almost there...",
];

const COMMENT_VERBS = [
  "Posting comment...",
  "Anchoring to text...",
];

const LINK_VERBS = [
  "Minting a fresh link...",
  "Setting permissions...",
];

const PANEL_COMMENTS_VERBS = [
  "Gathering feedback...",
  "Rounding up comments...",
  "Loading the conversation...",
];

const PANEL_LINKS_VERBS = [
  "Fetching share links...",
  "Loading permissions...",
  "Preparing link manager...",
];

type SpinnerContext = "upload" | "comment" | "link" | "panel-comments" | "panel-links";

const VERB_MAP: Record<SpinnerContext, string[]> = {
  upload: UPLOAD_VERBS,
  comment: COMMENT_VERBS,
  link: LINK_VERBS,
  "panel-comments": PANEL_COMMENTS_VERBS,
  "panel-links": PANEL_LINKS_VERBS,
};

export function Spinner({ context }: { context: SpinnerContext }) {
  const verbs = VERB_MAP[context];
  const [verbIndex, setVerbIndex] = useState(0);

  useEffect(() => {
    if (verbs.length <= 1) return;
    const interval = setInterval(() => {
      setVerbIndex((i) => (i + 1) % verbs.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [verbs]);

  return (
    <span className="inline-flex items-center gap-2">
      <svg
        className="w-4 h-4 animate-spin text-indigo-400"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="text-sm text-neutral-400">{verbs[verbIndex]}</span>
    </span>
  );
}
