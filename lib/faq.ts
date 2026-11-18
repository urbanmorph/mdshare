// One list of FAQs per page, rendered as the visible FAQ and as schema.org FAQPage JSON-LD,
// so the two can't drift (search engines ignore FAQ markup that doesn't match the page).

/** A question and its answer, as HTML for the page. */
export interface Faq {
  q: string;
  a: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

/** Plain text of a small HTML fragment: tags dropped, common entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|[a-z]+);/g, (m, e: string) => ENTITIES[e] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function faqJsonLd(faqs: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: htmlToText(f.a) },
    })),
  };
}
