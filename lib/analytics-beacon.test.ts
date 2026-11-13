// Cloudflare injects the Web Analytics beacon into every HTML response (auto-install), the
// Worker's /d/ pages included. A second, hand-written beacon carried the site tag where a token
// belongs: Cloudflare refused its reports, and on the pages that had both, no visit was counted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the layout leaves the analytics beacon to Cloudflare's auto-install", () => {
  const layout = readFileSync(new URL("../src/layouts/Layout.astro", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /cloudflareinsights\.com\/beacon/);
});
