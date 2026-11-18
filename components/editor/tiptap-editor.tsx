
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useEffect, useEffectEvent, useRef } from "react";
import { Toolbar } from "./toolbar";
import { promptForLink } from "./toolbar-state";
import { editorExtensions, getMarkdown } from "./extensions";
import { setCommentAnchors, type CommentAnchor } from "./comment-highlight";
import { createDebouncedSave, type SaveOptions } from "./debounced-save";

const SAVE_DELAY_MS = 3000;

interface TiptapEditorProps {
  content: string;
  /** Bumped by the parent each time `content` arrives from someone else (socket, poll, conflict). */
  contentRevision: number;
  /** Called once the editor shows the content of a given revision. */
  onContentApplied: (revision: number) => void;
  editable: boolean;
  /** Saves the markdown. Called 3 s after the last edit, or at once on Cmd+S and when the tab is hidden. */
  onUpdate?: (markdown: string, opts?: SaveOptions) => void;
  /** Keep the same array while the comments are unchanged; a new array rebuilds the highlights. */
  commentAnchors: CommentAnchor[];
  activeCommentId: string | null;
  lightMode: boolean;
  onToggleLight: () => void;
  isAdmin: boolean;
  onRequestComment?: (text: string, anchorStart: number, anchorEnd: number) => void;
}

export function TiptapEditor({
  content,
  contentRevision,
  onContentApplied,
  editable,
  onUpdate,
  commentAnchors,
  activeCommentId,
  lightMode,
  onToggleLight,
  isAdmin,
  onRequestComment,
}: TiptapEditorProps) {
  const saverRef = useRef<ReturnType<typeof createDebouncedSave> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: editorExtensions({ editable }),
    content,
    editable,
    editorProps: {
      attributes: {
        // dir="auto" lets the browser pick base direction per the first strong
        // character — RTL content (Arabic/Hebrew) right-aligns correctly, LTR is
        // unaffected. No UI, no language detection.
        dir: "auto",
        class: "prose prose-invert prose-sm max-w-none focus:outline-none",
      },
    },
  });

  const save = useEffectEvent((markdown: string, opts?: SaveOptions) => onUpdate?.(markdown, opts));

  // Edits save 3 s after the last keystroke, or at once on Cmd+S. When the tab is hidden
  // or closed the pending edit goes out with keepalive, so closing within 3 s loses nothing.
  useEffect(() => {
    if (!editor || !editable) return;
    const saver = createDebouncedSave(() => getMarkdown(editor), (md, opts) => save(md, opts), SAVE_DELAY_MS);
    saverRef.current = saver;
    // "update" fires for local edits only: remote content is applied with emitUpdate: false.
    const onEdit = () => saver.schedule();
    const flushKeepalive = () => saver.flush({ keepalive: true });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushKeepalive();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        saver.flush();
      } else if (key === "k") {
        e.preventDefault();
        promptForLink(editor);
      }
    };
    editor.on("update", onEdit);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushKeepalive);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      editor.off("update", onEdit);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushKeepalive);
      window.removeEventListener("keydown", onKeyDown);
      flushKeepalive();
      saverRef.current = null;
    };
  }, [editor, editable]);

  useEffect(() => {
    if (editor) setCommentAnchors(editor, commentAnchors, activeCommentId);
  }, [editor, commentAnchors, activeCommentId]);

  // Scroll to a highlighted anchor when activeCommentId changes
  useEffect(() => {
    if (!editor || !activeCommentId) return;
    // Small delay to let decorations render
    const timer = setTimeout(() => {
      editor.view.dom
        .querySelector(`[data-comment-id="${CSS.escape(activeCommentId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    return () => clearTimeout(timer);
  }, [editor, activeCommentId]);

  // Apply content that arrives from someone else (live updates, resync, conflict).
  // - Applied even while the editor has focus. Skipping it left a tab showing old
  //   text while believing it was current, and its next save overwrote newer work.
  // - Held back only while this tab has unsaved typing (a save is pending). That
  //   save carries the old base hash, the server answers 409, and the parent then
  //   bumps the revision so the newer content lands here.
  // - Applied with emitUpdate: false, so receiving content never triggers a save.
  const appliedRevision = useRef(contentRevision);
  useEffect(() => {
    if (!editor || contentRevision === appliedRevision.current) return;
    if (saverRef.current?.pending()) return;
    appliedRevision.current = contentRevision;
    if (getMarkdown(editor) !== content) {
      const { from, to } = editor.state.selection;
      editor.commands.setContent(content, { emitUpdate: false });
      if (editor.isFocused) {
        const end = editor.state.doc.content.size;
        editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
      }
    }
    onContentApplied(contentRevision);
  }, [content, contentRevision, editor, onContentApplied]);

  if (!editor) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {editable && <Toolbar editor={editor} lightMode={lightMode} onToggleLight={onToggleLight} isAdmin={isAdmin} />}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <EditorContent editor={editor} />
        {onRequestComment && (
          <BubbleMenu
            editor={editor}
            shouldShow={({ editor: e }) => {
              const { from, to, empty } = e.state.selection;
              if (empty || from === to) return false;
              const text = e.state.doc.textBetween(from, to, " ").trim();
              return text.length > 0;
            }}
          >
            <button
              type="button"
              aria-label="Comment on selection"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const { from, to } = editor.state.selection;
                const text = editor.state.doc.textBetween(from, to, " ").trim();
                if (text) {
                  onRequestComment(text, from, to);
                  // Collapse selection so iOS dismisses its native popup and
                  // shouldShow returns false (hides the bubble cleanly).
                  editor.commands.setTextSelection(to);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] bg-neutral-900 border border-neutral-700 rounded-lg text-xs text-neutral-200 hover:bg-neutral-800 hover:border-neutral-600 shadow-lg transition-colors touch-manipulation"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              Comment
            </button>
          </BubbleMenu>
        )}
      </div>
    </div>
  );
}
