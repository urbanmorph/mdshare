import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";
import { CommentHighlight } from "./comment-highlight.ts";

const lowlight = createLowlight(common);

/**
 * Everything the editor can represent. Markdown it has no node for is dropped
 * on load and therefore deleted on the next save, so every syntax the viewer
 * renders needs an extension here.
 */
export function editorExtensions({ editable }: { editable: boolean }) {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: false,
    }),
    CodeBlockLowlight.configure({
      lowlight,
      HTMLAttributes: { class: "hljs" },
    }),
    Placeholder.configure({
      placeholder: "Start writing...",
    }),
    Link.configure({
      openOnClick: !editable,
      HTMLAttributes: { class: "text-indigo-400 underline" },
    }),
    // Inline so `text ![x](url) text` survives as well as images on their own line.
    Image.configure({ inline: true }),
    Table.configure({
      resizable: false,
      HTMLAttributes: { class: "md-table" },
    }),
    TableRow,
    TableCell,
    TableHeader,
    Markdown,
    CommentHighlight,
  ];
}
