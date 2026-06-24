// Detects the dominant script of a document so we can render it natively:
// correct font, language metadata, and writing direction. Pure, no deps.
//
// "Polyglot content, English chrome" — this drives <html lang>, og:locale, and
// a conditional web-font <link>. It does NOT flip the app's `dir` (the content
// containers already use dir="auto"); see supporting-docs/multilingual-rendering-plan.md.

export type Script =
  | "latin"
  | "arabic"
  | "hebrew"
  | "cyrillic"
  | "han"
  | "japanese"
  | "korean"
  | "devanagari"
  | "thai"
  | "greek";

export interface LocaleInfo {
  script: Script;
  dir: "ltr" | "rtl";
  lang: string; // coarse BCP-47
  ogLocale: string; // Open Graph locale, e.g. ar_AR
  fontHref: string | null; // Google Fonts <link> href, or null for latin (Geist already loaded)
  fontFamily: string | null; // bare Google Fonts family (for OG subset fetch), null for latin
}

interface ScriptDef {
  script: Exclude<Script, "latin">;
  ranges: [number, number][];
  dir: "ltr" | "rtl";
  lang: string;
  ogLocale: string;
  fontFamily: string; // Google Fonts family name
}

const googleFont = (family: string): string =>
  `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400..700&display=swap`;

// Single source of truth. Adding a script = one row. Blocks are disjoint, so a
// code point matches at most one entry. Japanese/Korean precede Han only for
// readability; the Han→Japanese tie-break is handled explicitly below.
const SCRIPTS: ScriptDef[] = [
  { script: "arabic", ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0xfb50, 0xfdff], [0xfe70, 0xfeff]], dir: "rtl", lang: "ar", ogLocale: "ar_AR", fontFamily: "Noto Naskh Arabic" },
  { script: "hebrew", ranges: [[0x0590, 0x05ff]], dir: "rtl", lang: "he", ogLocale: "he_IL", fontFamily: "Noto Sans Hebrew" },
  { script: "japanese", ranges: [[0x3040, 0x30ff]], dir: "ltr", lang: "ja", ogLocale: "ja_JP", fontFamily: "Noto Sans JP" },
  { script: "korean", ranges: [[0xac00, 0xd7af], [0x1100, 0x11ff]], dir: "ltr", lang: "ko", ogLocale: "ko_KR", fontFamily: "Noto Sans KR" },
  { script: "han", ranges: [[0x4e00, 0x9fff], [0x3400, 0x4dbf]], dir: "ltr", lang: "zh", ogLocale: "zh_CN", fontFamily: "Noto Sans SC" },
  { script: "cyrillic", ranges: [[0x0400, 0x04ff]], dir: "ltr", lang: "ru", ogLocale: "ru_RU", fontFamily: "Noto Sans" },
  { script: "devanagari", ranges: [[0x0900, 0x097f]], dir: "ltr", lang: "hi", ogLocale: "hi_IN", fontFamily: "Noto Sans Devanagari" },
  { script: "thai", ranges: [[0x0e00, 0x0e7f]], dir: "ltr", lang: "th", ogLocale: "th_TH", fontFamily: "Noto Sans Thai" },
  { script: "greek", ranges: [[0x0370, 0x03ff]], dir: "ltr", lang: "el", ogLocale: "el_GR", fontFamily: "Noto Sans" },
];

const LATIN: LocaleInfo = { script: "latin", dir: "ltr", lang: "en", ogLocale: "en_US", fontHref: null, fontFamily: null };

const SAMPLE_LEN = 2000;
const THRESHOLD = 0.1; // dominant non-Latin script must be ≥10% of letters

function inRanges(cp: number, ranges: [number, number][]): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function isLatinLetter(cp: number): boolean {
  return (
    (cp >= 0x41 && cp <= 0x5a) || // A-Z
    (cp >= 0x61 && cp <= 0x7a) || // a-z
    (cp >= 0x00c0 && cp <= 0x024f) || // Latin-1 Supplement + Extended-A/B (accents)
    (cp >= 0x1e00 && cp <= 0x1eff) // Latin Extended Additional (e.g. Vietnamese)
  );
}

export function detectScript(text: string): LocaleInfo {
  if (!text) return LATIN;

  const counts = new Map<Script, number>();
  let letters = 0;

  for (const ch of text.slice(0, SAMPLE_LEN)) {
    const cp = ch.codePointAt(0)!;
    const def = SCRIPTS.find((d) => inRanges(cp, d.ranges));
    if (def) {
      counts.set(def.script, (counts.get(def.script) ?? 0) + 1);
      letters++;
    } else if (isLatinLetter(cp)) {
      letters++;
    }
  }

  if (letters === 0) return LATIN;

  let winner: ScriptDef | undefined;
  let max = 0;
  for (const def of SCRIPTS) {
    const c = counts.get(def.script) ?? 0;
    if (c > max) {
      max = c;
      winner = def;
    }
  }

  if (!winner || max / letters < THRESHOLD) return LATIN;

  // A Han-dominant doc that also contains kana is Japanese, not Chinese.
  if (winner.script === "han" && (counts.get("japanese") ?? 0) > 0) {
    winner = SCRIPTS.find((d) => d.script === "japanese")!;
  }

  return {
    script: winner.script,
    dir: winner.dir,
    lang: winner.lang,
    ogLocale: winner.ogLocale,
    fontHref: googleFont(winner.fontFamily),
    fontFamily: winner.fontFamily,
  };
}
