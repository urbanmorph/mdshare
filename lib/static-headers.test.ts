// public/_headers sets the headers Cloudflare's asset server sends for static files.
// Cloudflare has no MIME type for .vsix, so without a rule the extension download
// goes out with an empty Content-Type.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const headersFile = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");

// Header lines for one exact path rule, as { lower-cased name: value }.
function rule(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inRule = false;
  for (const line of headersFile.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    if (!/^\s/.test(line)) { inRule = line.trim() === path; continue; }
    if (!inRule) continue;
    const i = line.indexOf(":");
    out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

test("the VS Code extension downloads as a .vsix attachment", () => {
  const h = rule("/mdshare-vscode.vsix");
  assert.equal(h["content-type"], "application/vsix");
  assert.equal(h["content-disposition"], 'attachment; filename="mdshare-vscode.vsix"');
});
