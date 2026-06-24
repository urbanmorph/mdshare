import { test } from "node:test";
import assert from "node:assert/strict";
import { stripForOgTitle, wrapTitle, buildCardSvg, escapeXml, wordSpacingFor } from "./og-image.ts";

// --- stripForOgTitle ---

test("removes emoji and collapses whitespace", () => {
  assert.equal(stripForOgTitle("⚡ Launch 🚀  v2"), "Launch v2");
});

test("removes ZWJ emoji sequences", () => {
  assert.equal(stripForOgTitle("👨‍👩‍👧 Family plan"), "Family plan");
});

test("preserves CJK / Arabic, drops emoji", () => {
  assert.equal(stripForOgTitle("技术规格说明书"), "技术规格说明书");
  assert.equal(stripForOgTitle("مرحبا 🌙 بك"), "مرحبا بك");
});

test("empty / whitespace / emoji-only → Untitled", () => {
  assert.equal(stripForOgTitle(""), "Untitled");
  assert.equal(stripForOgTitle("🚀🎉"), "Untitled");
});

test("truncates long titles with an ellipsis, within maxLen", () => {
  const out = stripForOgTitle("A".repeat(200), 100);
  assert.ok(out.length <= 100);
  assert.ok(out.endsWith("…"));
});

// --- wrapTitle ---

test("short title stays one line", () => {
  assert.deepEqual(wrapTitle("Hello World", { script: "latin" }), ["Hello World"]);
});

test("word-wrap preserves words and stays within maxLines", () => {
  const t = "The quick brown fox jumps over the lazy dog again";
  const lines = wrapTitle(t, { script: "latin" });
  assert.ok(lines.length >= 1 && lines.length <= 3);
  assert.equal(lines.join(" "), t); // no truncation → exact reconstruction
});

test("over-long title truncates to maxLines with an ellipsis", () => {
  const t = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const lines = wrapTitle(t, { script: "latin", maxLines: 3 });
  assert.equal(lines.length, 3);
  assert.ok(lines[2].endsWith("…"));
});

test("CJK char-chunks (no spaces)", () => {
  const lines = wrapTitle("一二三四五六七八九十一二三四五六七八九十", { script: "han", maxLines: 10 });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].length, 15);
});

test("a single over-long word is hard-broken", () => {
  const lines = wrapTitle("x".repeat(40), { script: "latin", maxLines: 5 });
  assert.ok(lines.length > 1);
  assert.equal(lines[0].length, 27);
});

// --- buildCardSvg / escapeXml ---

test("card SVG has the frame, wordmark, footer, and each title line", () => {
  const svg = buildCardSvg({ lines: ["Hello", "World"], titleFamily: "Noto Sans", dir: "ltr", script: "latin" });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("</svg>"));
  assert.ok(svg.includes(">mdshare</text>"));
  assert.ok(svg.includes(">shared via mdshare</text>"));
  assert.ok(svg.includes(">Hello</text>"));
  assert.ok(svg.includes(">World</text>"));
});

test("RTL aligns the title to the right edge", () => {
  const svg = buildCardSvg({ lines: ["مرحبا"], titleFamily: "Noto Naskh Arabic", dir: "rtl", script: "arabic" });
  assert.ok(svg.includes('text-anchor="end"'));
  assert.ok(svg.includes('direction="rtl"'));
});

test("LTR anchors the title to the left", () => {
  const svg = buildCardSvg({ lines: ["Hi"], titleFamily: "Noto Sans", dir: "ltr", script: "latin" });
  assert.ok(svg.includes('text-anchor="start"'));
});

test("escapeXml escapes markup-significant characters", () => {
  assert.equal(escapeXml(`A & B <x> "q"`), "A &amp; B &lt;x&gt; &quot;q&quot;");
  const svg = buildCardSvg({ lines: ["A & B <x>"], titleFamily: "Noto Sans", dir: "ltr", script: "latin" });
  assert.ok(svg.includes("A &amp; B &lt;x&gt;"));
});

// --- wordSpacingFor (Devanagari space synthesis) ---

test("wordSpacingFor is positive for Devanagari, zero otherwise", () => {
  assert.ok(wordSpacingFor("devanagari", 68) > 0);
  assert.equal(wordSpacingFor("latin", 68), 0);
  assert.equal(wordSpacingFor("arabic", 68), 0);
});

test("Devanagari card injects word-spacing; Latin does not", () => {
  const deva = buildCardSvg({ lines: ["तकनीकी विनिर्देश"], titleFamily: "Noto Sans Devanagari", dir: "ltr", script: "devanagari" });
  assert.ok(/word-spacing="\d+"/.test(deva));
  const latin = buildCardSvg({ lines: ["Hello World"], titleFamily: "Noto Sans", dir: "ltr", script: "latin" });
  assert.ok(!latin.includes("word-spacing"));
});
