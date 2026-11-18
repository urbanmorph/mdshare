import { defaultSchema } from "rehype-sanitize";

/** rehype-sanitize's default schema plus highlight.js class names on code and span. Used by the
 *  document viewer (components/editor/markdown-html.ts) and the /docs page (lib/docs-content.ts). */
export const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), "className"],
    span: [...(defaultSchema.attributes?.span || []), "className"],
  },
};
