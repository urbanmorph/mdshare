import type { Editor } from "@tiptap/react";

/**
 * Which toolbar buttons show as active. Read through useEditorState, which re-renders the
 * toolbar only when one of these changes; useEditor alone does not re-render per transaction.
 */
export function toolbarState(editor: Editor) {
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    h1: editor.isActive("heading", { level: 1 }),
    h2: editor.isActive("heading", { level: 2 }),
    h3: editor.isActive("heading", { level: 3 }),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    blockquote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
    link: editor.isActive("link"),
    table: editor.isActive("table"),
  };
}

/** Ask for a URL and add, change or (when cleared) remove the link at the selection. */
export function promptForLink(editor: Editor) {
  if (editor.isActive("link")) {
    const url = prompt("Edit or clear URL (empty to remove):", editor.getAttributes("link").href || "");
    if (url === null) return; // cancelled
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  } else {
    const url = prompt("Enter URL:", "https://");
    if (url) editor.chain().focus().toggleLink({ href: url }).run();
  }
}
