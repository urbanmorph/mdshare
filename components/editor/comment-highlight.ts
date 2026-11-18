import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProsemirrorNode } from "@tiptap/pm/model";

export interface CommentAnchor {
  id: string;
  anchorText: string;
  anchorStart?: number;
  anchorEnd?: number;
}

interface HighlightState {
  decorations: DecorationSet;
  anchors: CommentAnchor[];
  activeId: string | null;
}

interface HighlightStorage {
  anchors: CommentAnchor[];
  activeCommentId: string | null;
}

const commentHighlightKey = new PluginKey<HighlightState>("commentHighlight");

/**
 * Build a flat map of { text, pos } for the entire document,
 * collapsing all text nodes with their absolute positions.
 * This lets us search for anchor text that spans across nodes/paragraphs.
 */
function buildTextMap(doc: ProsemirrorNode): { text: string; positions: number[] } {
  // positions[i] = the document position for character i in the concatenated text
  const chars: string[] = [];
  const positions: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        chars.push(node.text[i]);
        positions.push(pos + i);
      }
    } else if (node.isBlock && chars.length > 0) {
      // Insert a space between blocks so "end of paragraph" + "start of next"
      // doesn't accidentally concatenate words
      chars.push(" ");
      positions.push(-1); // sentinel — not a real position
    }
  });

  return { text: chars.join(""), positions };
}

/**
 * Normalize anchor text for matching: collapse whitespace/newlines into single spaces.
 */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The document's text, normalized, with a way back to positions: `normToOrig[i]` is the index
 * in the raw text of character `i` of the normalized text, and `positions` maps that to the doc.
 */
function buildSearchIndex(doc: ProsemirrorNode) {
  const { text, positions } = buildTextMap(doc);
  const normToOrig: number[] = [];
  let inWhitespace = false;
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i++; // normalize() trims the start
  for (; i < text.length; i++) {
    const space = /\s/.test(text[i]);
    if (!space || !inWhitespace) normToOrig.push(i);
    inWhitespace = space;
  }
  return { normalized: normalize(text), positions, normToOrig };
}

function buildDecorations(doc: ProsemirrorNode, anchors: CommentAnchor[], activeId: string | null): DecorationSet {
  let index: ReturnType<typeof buildSearchIndex> | null = null; // built once, only if needed
  const decorations: Decoration[] = [];

  for (const anchor of anchors) {
    const normalizedAnchor = normalize(anchor.anchorText ?? "");
    if (!normalizedAnchor) continue;
    const attrs = {
      class: anchor.id === activeId ? "comment-highlight comment-highlight-active" : "comment-highlight",
      "data-comment-id": anchor.id,
    };

    // Position-first: when a comment carries ProseMirror positions and the text there still
    // matches, anchor by position. The text search below always picks the first occurrence,
    // which is wrong when the same phrase appears more than once.
    const { anchorStart, anchorEnd } = anchor;
    if (
      typeof anchorStart === "number" &&
      typeof anchorEnd === "number" &&
      anchorStart >= 0 &&
      anchorStart < anchorEnd &&
      anchorEnd <= doc.content.size
    ) {
      try {
        if (normalize(doc.textBetween(anchorStart, anchorEnd, " ")) === normalizedAnchor) {
          decorations.push(Decoration.inline(anchorStart, anchorEnd, attrs));
          continue;
        }
      } catch {
        // fall through to text search
      }
    }

    index ??= buildSearchIndex(doc);
    const idx = index.normalized.indexOf(normalizedAnchor);
    if (idx === -1 || idx >= index.normToOrig.length) continue;
    const origStart = index.normToOrig[idx];
    const origEnd = index.normToOrig[Math.min(idx + normalizedAnchor.length - 1, index.normToOrig.length - 1)];
    const startDocPos = index.positions[origStart];
    const endDocPos = index.positions[origEnd];
    if (startDocPos === undefined || endDocPos === undefined || startDocPos === -1 || endDocPos === -1) continue;
    // Inline decorations span nodes on their own.
    decorations.push(Decoration.inline(startDocPos, endDocPos + 1, attrs));
  }

  return DecorationSet.create(doc, decorations);
}

/** Whether the transaction replaced the whole document, as setContent does for a remote edit. */
function replacesWholeDoc(tr: Transaction): boolean {
  return tr.steps.some(
    (step, i) => step instanceof ReplaceStep && step.from === 0 && step.to === tr.docs[i].content.size
  );
}

/** Highlight these comments' anchors. Pass a new array whenever the comments change. */
export function setCommentAnchors(editor: Editor, anchors: CommentAnchor[], activeCommentId: string | null) {
  const storage = (editor.storage as unknown as { commentHighlight: HighlightStorage }).commentHighlight;
  storage.anchors = anchors;
  storage.activeCommentId = activeCommentId;
  // An empty transaction makes the plugin's apply() see the new anchors.
  editor.view.dispatch(editor.state.tr);
}

export const CommentHighlight = Extension.create<object, HighlightStorage>({
  name: "commentHighlight",

  addStorage() {
    return { anchors: [], activeCommentId: null };
  },

  addProseMirrorPlugins() {
    // Read at apply time: setCommentAnchors() writes to this storage.
    const storage = () => this.storage;

    return [
      new Plugin<HighlightState>({
        key: commentHighlightKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty, anchors: [], activeId: null }),
          apply(tr, prev) {
            const { anchors, activeCommentId: activeId } = storage();
            // Same comments as last time: keep the decorations, mapped through any edit.
            // A whole-document replace removes every decoration, so that rebuilds.
            if (anchors === prev.anchors && activeId === prev.activeId && !replacesWholeDoc(tr)) {
              return tr.docChanged ? { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) } : prev;
            }
            return { decorations: buildDecorations(tr.doc, anchors, activeId), anchors, activeId };
          },
        },
        props: {
          decorations(state) {
            return commentHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement;
            const commentId = target.closest("[data-comment-id]")?.getAttribute("data-comment-id");
            if (!commentId) return false;
            window.dispatchEvent(new CustomEvent("comment-highlight-click", { detail: { commentId } }));
            return true;
          },
        },
      }),
    ];
  },
});
