import type { APIRoute } from "astro";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
// The Cloudflare adapter bundles this .wasm import as a WebAssembly.Module.
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { getDB } from "../../../../lib/db";
import { resolveToken } from "../../../../lib/permissions";
import type { DocumentRow } from "../../../../lib/db-types";
import { detectScript } from "../../../../lib/detect-script";
import { stripForOgTitle, wrapTitle, buildCardSvg } from "../../../../lib/og-image";

export const prerender = false;

const SITE = "https://mdshare.live";
const FALLBACK = `${SITE}/og.png`;
// Google Fonts serves woff2 to modern UAs; resvg decodes woff2 directly.
const FONT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// initWasm may run only once per isolate; cache the promise.
let wasmReady: Promise<unknown> | null = null;
const ensureWasm = () => (wasmReady ??= initWasm(resvgWasm));

// Per-isolate cache of font subsets (the chrome subset repeats across docs).
const fontCache = new Map<string, Uint8Array>();

async function loadFontSubset(family: string, weight: number, text: string): Promise<Uint8Array | null> {
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const hit = fontCache.get(url);
  if (hit) return hit;
  try {
    const css = await fetch(url, { headers: { "User-Agent": FONT_UA } }).then((r) => r.text());
    const i = css.indexOf("url(");
    if (i === -1) return null;
    const fontUrl = css.slice(i + 4, css.indexOf(")", i));
    const bytes = new Uint8Array(await fetch(fontUrl).then((r) => r.arrayBuffer()));
    fontCache.set(url, bytes);
    return bytes;
  } catch {
    return null;
  }
}

// Per-doc Open Graph card: the doc's title in its own script, rasterised on the
// edge by resvg (rustybuzz shaping handles every script). Same ?key gate as the
// page so the title never leaks. Any failure falls back to the static card.
export const GET: APIRoute = async ({ params, request }) => {
  const id = params.id!;
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return Response.redirect(FALLBACK, 302);

  try {
    const db = getDB();
    const resolved = await resolveToken(db, key);
    if (!resolved || resolved.documentId !== id) return Response.redirect(FALLBACK, 302);

    const doc = await db
      .prepare("SELECT * FROM documents WHERE id = ?")
      .bind(id)
      .first<DocumentRow>();
    if (!doc) return Response.redirect(FALLBACK, 302);

    const loc = detectScript(doc.content || doc.title || "");
    const title = stripForOgTitle(doc.title || "Untitled");
    const lines = wrapTitle(title, { script: loc.script });
    const titleFamily = loc.fontFamily ?? "Noto Sans";
    const latinTitle = !loc.fontFamily;

    // Noto Sans covers the wordmark/footer (+ a Latin title); a non-Latin title
    // also needs its script font, subset to just the title's glyphs.
    const fonts: Uint8Array[] = [];
    const chrome = await loadFontSubset("Noto Sans", 700, "mdshare shared via" + (latinTitle ? title : ""));
    if (chrome) fonts.push(chrome);
    if (!latinTitle) {
      const tf = await loadFontSubset(titleFamily, 700, title);
      if (tf) fonts.push(tf);
    }
    if (fonts.length === 0) return Response.redirect(FALLBACK, 302);

    await ensureWasm();
    const svg = buildCardSvg({ lines, titleFamily, dir: loc.dir, script: loc.script });
    const png = new Resvg(svg, {
      font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Noto Sans" },
    })
      .render()
      .asPng();
    if (png.byteLength < 100) throw new Error("empty render");

    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    });
  } catch {
    return Response.redirect(FALLBACK, 302);
  }
};
