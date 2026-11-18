
import { useMemo } from "react";
import { markdownToHtml } from "./markdown-html";

export function MarkdownViewer({ content }: { content: string }) {
  const html = useMemo(() => markdownToHtml(content), [content]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        {html === null ? (
          // Rendering failed: show the source as plain text, never as HTML.
          <pre dir="auto" className="prose-viewer whitespace-pre-wrap">{content}</pre>
        ) : (
          <div dir="auto" className="prose-viewer" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}
