import { test } from "node:test";
import assert from "node:assert/strict";
import { detectScript } from "./detect-script.ts";

// One representative sample per script. Asserts the full LocaleInfo contract.
const cases: Array<{
  name: string;
  text: string;
  script: string;
  dir: "ltr" | "rtl";
  lang: string;
  ogLocale: string;
}> = [
  { name: "arabic", text: "مرحبا بك في هذا المستند التقني", script: "arabic", dir: "rtl", lang: "ar", ogLocale: "ar_AR" },
  { name: "hebrew", text: "שלום עולם וברוך הבא למסמך", script: "hebrew", dir: "rtl", lang: "he", ogLocale: "he_IL" },
  { name: "cyrillic", text: "Техническая спецификация документа", script: "cyrillic", dir: "ltr", lang: "ru", ogLocale: "ru_RU" },
  { name: "chinese", text: "技术规格说明书文档资料", script: "han", dir: "ltr", lang: "zh", ogLocale: "zh_CN" },
  { name: "japanese", text: "技術仕様書類管理 かな", script: "japanese", dir: "ltr", lang: "ja", ogLocale: "ja_JP" },
  { name: "korean", text: "기술 사양서 문서입니다", script: "korean", dir: "ltr", lang: "ko", ogLocale: "ko_KR" },
  { name: "devanagari", text: "तकनीकी विनिर्देश दस्तावेज़", script: "devanagari", dir: "ltr", lang: "hi", ogLocale: "hi_IN" },
  { name: "thai", text: "ข้อกำหนดทางเทคนิคของเอกสาร", script: "thai", dir: "ltr", lang: "th", ogLocale: "th_TH" },
  { name: "greek", text: "Τεχνικές προδιαγραφές εγγράφου", script: "greek", dir: "ltr", lang: "el", ogLocale: "el_GR" },
  { name: "latin", text: "Technical specification document", script: "latin", dir: "ltr", lang: "en", ogLocale: "en_US" },
];

for (const c of cases) {
  test(`detects ${c.name}`, () => {
    const info = detectScript(c.text);
    assert.equal(info.script, c.script, "script");
    assert.equal(info.dir, c.dir, "dir");
    assert.equal(info.lang, c.lang, "lang");
    assert.equal(info.ogLocale, c.ogLocale, "ogLocale");
  });
}

// Spec 2 needs the bare Google Fonts family (to fetch a subset for the OG card).
test("exposes the Google Fonts family for OG subset fetching", () => {
  assert.equal(detectScript("مرحبا بك").fontFamily, "Noto Naskh Arabic");
  assert.equal(detectScript("技术规格").fontFamily, "Noto Sans SC");
  assert.equal(detectScript("Техническая").fontFamily, "Noto Sans");
  assert.equal(detectScript("Hello world").fontFamily, null);
});

// --- Edge cases ---

test("mixed Arabic+English where Arabic dominates → arabic", () => {
  assert.equal(detectScript("API توثيق المرجع للمستخدم Reference").script, "arabic");
});

test("mostly-Arabic doc with a Latin code block → still arabic", () => {
  const doc = "هذا توثيق تقني مفصل جدا للمستند\n\n```js\nconst x = 1;\n```\nمزيد من النص العربي هنا";
  assert.equal(detectScript(doc).script, "arabic");
});

test("Han-dominant doc that contains kana → japanese (not zh)", () => {
  // 8 Han + 2 kana: raw count favours Han, but kana presence makes it Japanese.
  assert.equal(detectScript("技術仕様書類管理かな").script, "japanese");
});

test("emoji/symbol only → latin default", () => {
  assert.equal(detectScript("⚡ Launch 🚀 v2").script, "latin");
});

test("Vietnamese is Latin script → latin/en, no extra font", () => {
  const info = detectScript("GIẢI PHÁP MULTI-TENANT cho hệ thống");
  assert.equal(info.script, "latin");
  assert.equal(info.lang, "en");
  assert.equal(info.fontFamily, null);
});

test("empty/whitespace → latin default", () => {
  const info = detectScript("   \n\t ");
  assert.equal(info.script, "latin");
  assert.equal(info.lang, "en");
  assert.equal(info.dir, "ltr");
  assert.equal(info.ogLocale, "en_US");
  assert.equal(info.fontFamily, null);
});
