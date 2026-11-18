
import { downloadMarkdown } from "../../lib/download-markdown";

interface DownloadButtonProps {
  /** The markdown as this tab shows it. */
  content: string;
  title: string;
}

export function DownloadButton({ content, title }: DownloadButtonProps) {
  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${title} — mdshare`, text: title, url });
        return;
      } catch {
        // User dismissed the share sheet; fall through to clipboard copy.
      }
    }
    // Fallback: copy the URL. Nothing to tell the user if the clipboard is blocked too.
    navigator.clipboard?.writeText(url).catch(() => {});
  };

  return (
    <>
      {/* Mobile: share button only */}
      <button
        onClick={handleShare}
        className="p-2 bg-indigo-900/30 hover:bg-indigo-900/50 text-indigo-400 border border-indigo-800 rounded-lg transition-colors touch-manipulation sm:hidden"
        title="Share"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      </button>
      {/* Desktop: download button only */}
      <button
        onClick={() => downloadMarkdown(content, title)}
        className="hidden sm:flex p-2 sm:px-3 sm:py-1.5 bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-800 rounded-lg transition-colors touch-manipulation items-center"
        title="Download .md"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </button>
    </>
  );
}
