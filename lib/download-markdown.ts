/** A safe file name for the title; letters and digits in any script are kept. */
export function markdownFilename(title: string): string {
  const name = title.trim().replace(/[^\p{L}\p{M}\p{N}_-]/gu, "_");
  return `${name || "Untitled"}.md`;
}

interface DownloadEnv {
  createElement: (tag: "a") => { href: string; download: string; click(): void };
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

const browser: DownloadEnv = {
  createElement: (tag) => document.createElement(tag),
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
};

/** Save `content` as `<title>.md`. Used by the download button and Cmd+D. */
export function downloadMarkdown(content: string, title: string, env: DownloadEnv = browser): void {
  const url = env.createObjectURL(new Blob([content], { type: "text/markdown" }));
  const a = env.createElement("a");
  a.href = url;
  a.download = markdownFilename(title);
  a.click();
  env.revokeObjectURL(url);
}
