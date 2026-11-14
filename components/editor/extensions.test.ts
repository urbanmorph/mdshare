import { test, after } from "node:test";
import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Tiptap needs a DOM; register one before loading the editor modules.
GlobalRegistrator.register();
const { Editor } = await import("@tiptap/core");
const { editorExtensions } = await import("./extensions.ts");

let editor: InstanceType<typeof Editor> | undefined;

// The editor saves whatever this returns, so anything it drops is deleted from the document.
function roundTrip(markdown: string): string {
  editor?.destroy();
  editor = new Editor({ extensions: editorExtensions({ editable: true }), content: markdown });
  const storage = editor.storage as unknown as { markdown: { getMarkdown(): string } };
  return storage.markdown.getMarkdown();
}

after(async () => {
  editor?.destroy();
  await GlobalRegistrator.unregister();
});

test("keeps an image on its own line", () => {
  const md = "Before\n\n![chart](https://example.com/a.png)\n\nAfter";
  assert.equal(roundTrip(md), md);
});

test("keeps an image inside a paragraph", () => {
  const md = "Inline ![x](https://example.com/b.png) text";
  assert.equal(roundTrip(md), md);
});

test("keeps an image title", () => {
  const md = '![alt](https://example.com/c.png "Title")';
  assert.equal(roundTrip(md), md);
});

test("still round-trips links, tables and code", () => {
  const md = [
    "[mdshare](https://mdshare.live)",
    "",
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "```js",
    "const x = 1;",
    "```",
  ].join("\n");
  assert.equal(roundTrip(md), md);
});
