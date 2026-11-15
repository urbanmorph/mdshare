// Where a new document came from, for the count of sources (ops reads documents.source).
// Order matters: the first match wins.

export type DocumentSource = "blank" | "paste" | "upload" | "mcp" | "cli" | "vscode" | "obsidian" | "api";

export function documentSource(r: { contentType: string; userAgent: string; origin: string; xSource: string }): DocumentSource {
  if (r.contentType.includes("multipart/form-data")) return "upload";
  if (r.xSource === "blank") return "blank";
  if (/^mdshare-mcp\//i.test(r.userAgent)) return "mcp";
  if (/^mdshare-cli\//i.test(r.userAgent)) return "cli"; // the mdshare-mcp package's command line
  if (/mdshare-vscode/i.test(r.userAgent)) return "vscode";
  if (/mdshare-obsidian|Obsidian/i.test(r.userAgent)) return "obsidian";
  if (/^https?:\/\/(mdshare\.live|localhost(:\d+)?)$/i.test(r.origin)) return "paste";
  return "api";
}
