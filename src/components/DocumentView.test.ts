import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * Every package reached through static imports from `entry`: what the browser must download
 * before the island renders. Type-only imports and lazy import() calls are not followed.
 */
function staticPackages(entry: string): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      const local = spec.startsWith(".") ? resolve(dirname(file), spec) : spec.startsWith("@/") ? resolve(ROOT, spec.slice(2)) : null;
      if (!local) { packages.add(spec); continue; }
      const hit = EXTS.map((e) => local + e).find((p) => existsSync(p) && !p.endsWith("/"));
      if (hit) visit(hit);
    }
  };
  visit(resolve(ROOT, entry));
  return packages;
}

test("a document opens without downloading the editor", () => {
  const tiptap = [...staticPackages("src/components/DocumentView.tsx")].filter((p) => p.startsWith("@tiptap/") || p === "tiptap-markdown");
  assert.deepEqual(tiptap, [], "view-only readers would download Tiptap before seeing any text");
});

test("the walker does find Tiptap when it is imported", () => {
  assert.ok(staticPackages("components/editor/tiptap-editor.tsx").has("@tiptap/react"));
});
