import { test, after } from "node:test";
import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
const { Editor } = await import("@tiptap/core");
const { editorExtensions } = await import("./extensions.ts");
const { setCommentAnchors } = await import("./comment-highlight.ts");

const editors: InstanceType<typeof Editor>[] = [];
after(async () => {
  for (const e of editors) e.destroy();
  await GlobalRegistrator.unregister();
});

function makeEditor(content: string) {
  const editor = new Editor({ extensions: editorExtensions({ editable: true }), content });
  editors.push(editor);
  return editor;
}

/** Ids of the comments highlighted in the editor right now. */
function highlighted(editor: InstanceType<typeof Editor>): string[] {
  return [...editor.view.dom.querySelectorAll("[data-comment-id]")]
    .map((el) => el.getAttribute("data-comment-id")!)
    .sort();
}

test("highlights survive a full-document replace from another tab", () => {
  const editor = makeEditor("Alpha beta gamma\n\nDelta epsilon");
  setCommentAnchors(editor, [{ id: "c1", anchorText: "beta" }], null);
  assert.deepEqual(highlighted(editor), ["c1"]);
  editor.commands.setContent("Alpha beta gamma, now longer\n\nDelta epsilon", { emitUpdate: false });
  assert.deepEqual(highlighted(editor), ["c1"]);
});

test("a resolve plus a new comment (same count) rebuilds the highlights", () => {
  const editor = makeEditor("Alpha beta gamma\n\nDelta epsilon");
  setCommentAnchors(editor, [{ id: "c1", anchorText: "beta" }], null);
  assert.deepEqual(highlighted(editor), ["c1"]);
  setCommentAnchors(editor, [{ id: "c2", anchorText: "epsilon" }], null);
  assert.deepEqual(highlighted(editor), ["c2"]);
});

test("typing keeps highlights by mapping them", () => {
  const editor = makeEditor("Alpha beta gamma");
  setCommentAnchors(editor, [{ id: "c1", anchorText: "gamma" }], null);
  editor.commands.insertContentAt(1, "Hey ");
  assert.deepEqual(highlighted(editor), ["c1"]);
  assert.equal(editor.view.dom.querySelector("[data-comment-id]")!.textContent, "gamma");
});

test("text search finds an anchor across a block boundary", () => {
  const editor = makeEditor("one two\n\nthree four");
  setCommentAnchors(editor, [{ id: "c1", anchorText: "two three" }, { id: "c2", anchorText: "four" }], "c2");
  assert.deepEqual(highlighted(editor), ["c1", "c1", "c2"]);
  assert.ok(editor.view.dom.querySelector('[data-comment-id="c2"]')!.classList.contains("comment-highlight-active"));
});
