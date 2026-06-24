// Pure helpers for the per-doc Open Graph image route. No deps.
// See supporting-docs/multilingual-rendering-plan.md (Spec 2).

import type { Script } from "./detect-script.ts";

const MAX_OG_TITLE = 100;

// Strip emoji / pictographs and collapse whitespace. resvg renders text from the
// supplied fonts only; with no colour-emoji font, emoji would draw as tofu, so we
// remove them. Letters of every script are preserved.
export function stripForOgTitle(raw: string, maxLen = MAX_OG_TITLE): string {
  const cleaned = (raw || "")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/[\uFE0F\u200D]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Untitled";
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1).trimEnd() + "\u2026";
}

// Average glyph advance as a fraction of em, per script. resvg has no text
// measurement API, so we estimate to wrap the title -- deliberately a touch
// conservative so we wrap a line early rather than overflow the card.
const ADVANCE: Record<Script, number> = {
  latin: 0.55,
  cyrillic: 0.6,
  greek: 0.55,
  arabic: 0.5,
  hebrew: 0.55,
  devanagari: 0.62,
  thai: 0.62,
  han: 1,
  japanese: 1,
  korean: 1,
};

const NO_SPACE: ReadonlySet<Script> = new Set(["han", "japanese", "korean", "thai"]);

// Some Noto fonts (e.g. Noto Sans Devanagari) ship no U+0020 glyph, and resvg
// won't fall back to another font mid-run, so word spaces collapse to nothing.
// Synthesise the gap with the SVG word-spacing attribute for those scripts.
const NEEDS_WORD_SPACE: ReadonlySet<Script> = new Set<Script>(["devanagari"]);

export function wordSpacingFor(script: Script, fontSize: number): number {
  return NEEDS_WORD_SPACE.has(script) ? Math.round(fontSize * 0.28) : 0;
}

export interface WrapOpts {
  script?: Script;
  maxWidth?: number;
  fontSize?: number;
  maxLines?: number;
}

// Break a title into lines that fit the card: word-wrap space-separated scripts,
// char-chunk scripts without spaces (CJK/Thai), cap at maxLines with an ellipsis.
export function wrapTitle(title: string, opts: WrapOpts = {}): string[] {
  const { script = "latin", maxWidth = 1040, fontSize = 68, maxLines = 3 } = opts;
  const per = Math.max(1, Math.floor(maxWidth / (fontSize * (ADVANCE[script] ?? 0.55))));
  let lines = NO_SPACE.has(script) ? chunk(title, per) : wordWrap(title, per);
  if (lines.length === 0) lines = [""];
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const i = maxLines - 1;
    const last = lines[i].length > per - 1 ? lines[i].slice(0, per - 1) : lines[i];
    lines[i] = last.replace(/\s+$/, "") + "\u2026";
  }
  return lines;
}

function chunk(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

function wordWrap(s: string, per: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > per) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, per));
      w = w.slice(per);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= per) cur = cur + " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface CardOpts {
  lines: string[];
  titleFamily: string;
  dir: "ltr" | "rtl";
  script: Script;
  fontSize?: number;
}

// Build the 1200x630 card SVG. resvg shapes the <text> via rustybuzz, so every
// script renders correctly. Wordmark + footer stay top-left; the title aligns
// right for RTL.
export function buildCardSvg({ lines, titleFamily, dir, script, fontSize = 68 }: CardOpts): string {
  const W = 1200;
  const H = 630;
  const padX = 80;
  const lh = Math.round(fontSize * 1.25);
  const blockH = lines.length * lh;
  const baseline = Math.round((H - blockH) / 2 + fontSize);
  const rtl = dir === "rtl";
  const x = rtl ? W - padX : padX;
  const anchor = rtl ? "end" : "start";
  const ws = wordSpacingFor(script, fontSize);
  const wsAttr = ws ? ` word-spacing="${ws}"` : "";
  const title = lines
    .map(
      (ln, i) =>
        `<text x="${x}" y="${baseline + i * lh}" text-anchor="${anchor}" direction="${dir}"${wsAttr} font-family="'${titleFamily}','Noto Sans'" font-size="${fontSize}" font-weight="700" fill="#fafafa">${escapeXml(ln)}</text>`
    )
    .join("");
  return (
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${W}" height="${H}" fill="#0a0a0a"/>` +
    `<text x="${padX}" y="120" font-family="'Noto Sans'" font-size="34" font-weight="700" fill="#a3a3a3">mdshare</text>` +
    title +
    `<text x="${padX}" y="${H - 70}" font-family="'Noto Sans'" font-size="26" fill="#737373">shared via mdshare</text>` +
    `</svg>`
  );
}
