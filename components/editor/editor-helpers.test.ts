import { test, after } from "node:test";
import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
const { Editor } = await import("@tiptap/core");
const { editorExtensions, getMarkdown } = await import("./extensions.ts");
const { toolbarState } = await import("./toolbar-state.ts");
const { markdownToHtml } = await import("./markdown-html.ts");

const editors: InstanceType<typeof Editor>[] = [];
after(async () => {
  for (const e of editors) e.destroy();
  await GlobalRegistrator.unregister();
});

test("toolbar state reflects the mark and block at the cursor", () => {
  const editor = new Editor({ extensions: editorExtensions({ editable: true }), content: "plain **bold** text\n\n## Head" });
  editors.push(editor);
  editor.commands.setTextSelection(3);
  assert.equal(toolbarState(editor).bold, false);
  editor.commands.setTextSelection(10); // inside "bold"
  assert.equal(toolbarState(editor).bold, true);
  assert.equal(toolbarState(editor).table, false);
  editor.commands.setTextSelection(20); // inside "Head"
  assert.equal(toolbarState(editor).h2, true);
  assert.equal(getMarkdown(editor), "plain **bold** text\n\n## Head");
});

test("code without a language is not auto-highlighted", () => {
  const html = markdownToHtml("```\nconst x = 1;\n```")!;
  assert.doesNotMatch(html, /hljs-/);
  assert.match(markdownToHtml("```js\nconst x = 1;\n```")!, /hljs-keyword/);
});

test("the viewer's HTML is sanitized", () => {
  const html = markdownToHtml('<img src=x onerror="alert(1)"> <script>alert(1)</script>')!;
  assert.doesNotMatch(html, /onerror|<script/);
});
