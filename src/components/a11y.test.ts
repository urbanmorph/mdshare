import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Static checks for the accessibility failures Lighthouse found on the home and
// document pages. They read the component source, like DocumentView.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

const DOCUMENT_PAGE = [
  "src/components/DocumentView.tsx",
  "src/components/DocumentParts.tsx",
  "components/editor/comment-sidebar.tsx",
  "components/ui/link-manager.tsx",
  "components/ui/shortcuts-help.tsx",
];
const HOME_PAGE = ["src/components/Home.tsx", "src/components/RecentSync.tsx"];

// Tailwind v4 neutral scale (sRGB fallbacks) and the page background (--background).
const NEUTRAL: Record<number, string> = { 300: "#d4d4d4", 400: "#a3a3a3", 500: "#737373", 600: "#525252" };
const PAGE_BG = "#0a0a0a";
const PANEL_BG = "#171717"; // neutral-900, used for cards and kbd

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("neutral-400 is the darkest neutral that passes 4.5:1 for small text on the dark UI", () => {
  for (const bg of [PAGE_BG, PANEL_BG]) assert.ok(contrast(NEUTRAL[400], bg) >= 4.5, `400 on ${bg}`);
  assert.ok(contrast(NEUTRAL[500], PAGE_BG) < 4.5, "500 fails, so 400 is the smallest change");
});

test("small text on the home and document pages does not use neutral-500/600", () => {
  // Base text colour only: hover:, disabled: and placeholder- variants are not checked by axe
  // or are lighter-on-hover states.
  const dim = /(?<![\w:-])text-neutral-(500|600)\b/g;
  for (const file of [...DOCUMENT_PAGE, ...HOME_PAGE]) {
    const lines = read(file).split("\n");
    const hits = lines.flatMap((l, i) => (l.match(dim) ? [`${file}:${i + 1}: ${l.trim()}`] : []));
    assert.deepEqual(hits, [], "fails 4.5:1 on the dark background; use text-neutral-400");
  }
});

test("hover states stay lighter than the neutral-400 base", () => {
  // The base (on the element or inherited from its parent) is now neutral-400 at the darkest,
  // so a hover of 400 or darker would show no change.
  for (const file of [...DOCUMENT_PAGE, ...HOME_PAGE]) {
    assert.doesNotMatch(read(file), /hover:text-neutral-(400|500|600)\b/, file);
  }
});

/** Each <button>'s attributes and children. Skips `>` inside {...}, such as `() =>`. */
function buttons(src: string): { attrs: string; body: string }[] {
  const out = [];
  for (let at = src.indexOf("<button"); at !== -1; at = src.indexOf("<button", at + 1)) {
    let i = at + "<button".length;
    for (let depth = 0; i < src.length && !(depth === 0 && src[i] === ">"); i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    out.push({ attrs: src.slice(at, i), body: src.slice(i + 1, src.indexOf("</button>", i)) });
  }
  return out;
}

test("the button scanner sees past arrow functions", () => {
  const [b] = buttons(`<button onClick={() => go()} title="x"><svg></svg></button>`);
  assert.match(b.attrs, /title="x"/);
  assert.equal(b.body, "<svg></svg>");
});

test("icon-only buttons have an accessible name", () => {
  for (const file of DOCUMENT_PAGE) {
    for (const { attrs, body } of buttons(read(file))) {
      const text = body.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim();
      if (text) continue; // visible text or a JSX expression names it
      assert.match(attrs, /aria-label=|title=/, `${file}: icon-only <button${attrs.slice(0, 80)}...> has no name`);
    }
  }
});

test("the side panel's headings start at h2, so they never skip a level", () => {
  for (const file of DOCUMENT_PAGE) {
    const levels = [...read(file).matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    if (levels.length) assert.equal(Math.min(...levels), 2, `${file} headings: ${levels.join(",")}`);
  }
});
