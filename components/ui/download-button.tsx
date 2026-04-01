"use client";

interface DownloadButtonProps {
  documentId: string;
  tokenKey: string;
  title: string;
}

export function DownloadButton({
  documentId,
  tokenKey,
  title,
}: DownloadButtonProps) {
  const handleDownload = async () => {
    const res = await fetch(`/api/d/${documentId}?key=${tokenKey}`, {
      headers: { Accept: "text/markdown" },
    });
    if (!res.ok) return;

    const content = await res.text();
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9-_]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleDownload}
      className="p-2 sm:px-3 sm:py-1.5 bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-800 rounded-lg transition-colors touch-manipulation"
      title="Download .md"
    >
      <svg className="w-4 h-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      <span className="hidden sm:inline text-sm">.md</span>
    </button>
  );
}
