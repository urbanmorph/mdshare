import { test } from "node:test";
import assert from "node:assert/strict";
import { faqJsonLd, htmlToText } from "./faq.ts";

test("htmlToText drops tags, decodes entities and collapses whitespace", () => {
  assert.equal(htmlToText("Run <code>npx  mdshare-mcp</code>\n  &amp; it&apos;s &quot;done&quot; &lt;3"), `Run npx mdshare-mcp & it's "done" <3`);
});

test("faqJsonLd builds a schema.org FAQPage from the same answers the page shows", () => {
  const ld = faqJsonLd([{ q: "How long?", a: "<strong>90 days</strong> by default." }]);
  assert.deepEqual(ld, {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [{ "@type": "Question", name: "How long?", acceptedAnswer: { "@type": "Answer", text: "90 days by default." } }],
  });
});
