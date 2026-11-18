import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";

// Extend sanitize schema to allow highlight.js class names on code/span
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), "className"],
    span: [...(defaultSchema.attributes?.span || []), "className"],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  // Only code blocks that name their language are highlighted; guessing is slow and often wrong.
  .use(rehypeHighlight, { detect: false })
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify);

/** Sanitized HTML for the markdown, or null if it could not be rendered. */
export function markdownToHtml(content: string): string | null {
  try {
    return String(processor.processSync(content));
  } catch {
    return null;
  }
}
