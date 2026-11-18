import { useState, useCallback, useEffect, useEffectEvent, useMemo, lazy, Suspense } from "react";
import { Spinner } from "../../components/ui/spinner";
import { MarkdownViewer } from "../../components/editor/markdown-viewer";
import type { DocumentRow } from "../../lib/db-types";
import type { Permission } from "../../lib/tokens";
import type { CommentAnchor } from "../../components/editor/comment-highlight";
import { useDocumentSync } from "../../lib/use-document-sync";
import { useDisplayName } from "../../lib/use-display-name";
import { saveRecentDoc } from "../../lib/recent-docs";
import { syncRecentSoon } from "../../lib/recent-sync";
import { useUnreadCount, seedLastSeenIfMissing, pruneLastSeen } from "../../lib/lastseen";
import { safeGet, safeSet, safeRemove } from "../../lib/storage";
import { downloadMarkdown } from "../../lib/download-markdown";
import { DocumentHeader, NewDocBanner, ConflictBanner, StatusBar, type Panel } from "./DocumentParts";

// The editor is most of the page's JavaScript; view-only readers never download it.
const TiptapEditor = lazy(() => import("../../components/editor/tiptap-editor").then(m => ({ default: m.TiptapEditor })));
const CommentSidebar = lazy(() => import("../../components/editor/comment-sidebar").then(m => ({ default: m.CommentSidebar })));
const LinkManager = lazy(() => import("../../components/ui/link-manager").then(m => ({ default: m.LinkManager })));

interface DocumentViewProps {
  document: DocumentRow;
  permission: Permission;
  tokenKey: string;
  /** Unused: the comment bubble is always on. Still passed by src/pages/d/[id].astro. */
  enableCommentBubble?: boolean;
}

/** Whether this page was opened from "create", which adds ?new=1 to the admin link. */
const isNewDocUrl = () => new URLSearchParams(window.location.search).get("new") === "1";

/** Light or dark editor, remembered in this browser. */
function useLightEditor() {
  const [light, setLight] = useState(() => safeGet("editorLight") === "true");
  useEffect(() => safeSet("editorLight", String(light)), [light]);
  const toggle = useCallback(() => setLight((v) => !v), []);
  return [light, toggle] as const;
}

export function DocumentView({ document: doc, permission, tokenKey }: DocumentViewProps) {
  const editable = permission === "admin" || permission === "edit";
  // Commenters and editors get the Tiptap editor; view-only readers get the plain viewer.
  const canComment = editable || permission === "comment";
  const { name: displayName, setName: setDisplayName } = useDisplayName();
  const [lightEditor, toggleLightEditor] = useLightEditor();

  const [openPanel, setOpenPanel] = useState<Panel | null>(() => {
    if (isNewDocUrl() && permission === "admin") return "links";
    const saved = safeGet("openPanel");
    if (saved === "links" && permission === "admin") return "links";
    if (saved === "comments" && canComment) return "comments";
    return null;
  });
  useEffect(() => {
    if (openPanel) safeSet("openPanel", openPanel);
    else safeRemove("openPanel");
  }, [openPanel]);
  const togglePanel = useCallback((panel: Panel) => {
    setOpenPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const [showNewBanner, setShowNewBanner] = useState(isNewDocUrl);
  // Drop ?new=1 so a reload or a bookmark doesn't show the banner again.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("new")) return;
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const [pendingAnchor, setPendingAnchor] = useState<{ text: string; start: number; end: number } | null>(null);
  const handleRequestComment = useCallback((text: string, start: number, end: number) => {
    setPendingAnchor({ text, start, end });
    setOpenPanel("comments");
  }, []);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);

  const sync = useDocumentSync({
    documentId: doc.id,
    tokenKey,
    initialContent: doc.content,
    initialHash: doc.content_hash,
    usesEditor: canComment,
    displayName,
  });
  const { liveContent, comments } = sync;

  const currentTitle = useMemo(() => {
    const m = liveContent.match(/^#\s+(.+)$/m);
    return (m ? m[1].trim() : doc.title) || "Untitled";
  }, [liveContent, doc.title]);
  const wordCount = useMemo(() => liveContent.split(/\s+/).filter(Boolean).length, [liveContent]);

  useEffect(() => {
    saveRecentDoc({ id: doc.id, title: currentTitle, key: tokenKey, permission });
  }, [doc.id, currentTitle, tokenKey, permission]);

  // Once per document opened (not per title keystroke): send the visit to the
  // user's other devices if they turned sync on.
  useEffect(() => {
    syncRecentSoon();
  }, [doc.id, tokenKey]);

  // Seed lastseen on first visit so the badge doesn't claim everything is
  // unread on a doc you've never opened. Prune oldest entries to keep
  // localStorage bounded.
  useEffect(() => {
    seedLastSeenIfMissing(doc.id);
    pruneLastSeen();
  }, [doc.id]);

  const { unreadCount, markSeen } = useUnreadCount(doc.id, comments);

  // Advance lastseen when the comments panel is open AND the tab is visible
  // — that's when the user has a chance to actually see the comments.
  // Re-fires whenever new comments arrive while watching.
  useEffect(() => {
    if (openPanel !== "comments") return;
    const advanceIfVisible = () => {
      if (document.visibilityState === "visible") markSeen();
    };
    advanceIfVisible();
    document.addEventListener("visibilitychange", advanceIfVisible);
    return () => document.removeEventListener("visibilitychange", advanceIfVisible);
  }, [openPanel, comments, markSeen]);

  const commentAnchors: CommentAnchor[] = useMemo(
    () =>
      comments
        .filter((c) => c.anchor_text && !c.resolved)
        .map((c) => ({
          id: c.id,
          anchorText: c.anchor_text!,
          anchorStart: c.anchor_start ?? undefined,
          anchorEnd: c.anchor_end ?? undefined,
        })),
    [comments]
  );

  // Page shortcuts. Cmd+S and Cmd+K belong to the editor.
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (e.shiftKey && key === "j") {
      e.preventDefault();
      toggleLightEditor();
    } else if (key === "\\") {
      e.preventDefault();
      if (canComment) togglePanel("comments");
    } else if (key === "l" && permission === "admin") {
      e.preventDefault();
      togglePanel("links");
    } else if (key === "d") {
      e.preventDefault();
      downloadMarkdown(liveContent, currentTitle);
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onShortcut(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex flex-col h-dvh">
      <DocumentHeader
        title={currentTitle}
        content={liveContent}
        permission={permission}
        canComment={canComment}
        viewers={sync.viewers}
        commentCount={comments.length}
        unreadCount={unreadCount}
        openPanel={openPanel}
        onTogglePanel={togglePanel}
      />

      {showNewBanner && <NewDocBanner onDismiss={() => setShowNewBanner(false)} />}
      {sync.conflictDraft !== null && <ConflictBanner draft={sync.conflictDraft} onDismiss={sync.dismissConflict} />}

      {/* Mobile title bar */}
      <div className="sm:hidden px-3 py-1.5 border-b border-neutral-800 bg-neutral-950">
        <span className="text-xs text-neutral-400 truncate block">{currentTitle}</span>
      </div>

      {/* Read-only bar */}
      {!editable && (
        <div className="flex items-center justify-between px-3 sm:px-5 py-2 bg-neutral-950 border-b border-neutral-800 text-xs text-neutral-400">
          <span>{permission === "comment" ? "Read-only · Select text then add a comment" : "View only"}</span>
          <button
            onClick={toggleLightEditor}
            className="px-2 py-1 rounded text-neutral-400 hover:bg-neutral-800 transition-colors"
            title={lightEditor ? "Switch to dark" : "Switch to light"}
          >
            {lightEditor ? "☾" : "☀"}
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Editor — always rendered, flex-1 */}
        <div className={`flex flex-col flex-1 min-h-0 min-w-0 editor-area${lightEditor ? " editor-light" : ""}`}>
          {canComment ? (
            // The text shows at once in the viewer while the editor loads.
            <Suspense fallback={<MarkdownViewer content={liveContent} />}>
              <TiptapEditor
                content={liveContent}
                contentRevision={sync.contentRevision}
                onContentApplied={sync.handleContentApplied}
                editable={editable}
                onUpdate={editable ? sync.save : undefined}
                commentAnchors={commentAnchors}
                activeCommentId={activeCommentId}
                lightMode={lightEditor}
                onToggleLight={toggleLightEditor}
                isAdmin={permission === "admin"}
                onRequestComment={handleRequestComment}
              />
            </Suspense>
          ) : (
            <MarkdownViewer content={liveContent} />
          )}
          <StatusBar
            saveStatus={sync.saveStatus}
            wsStatus={sync.wsStatus}
            wordCount={wordCount}
            displayName={displayName}
            onChangeName={setDisplayName}
          />
        </div>

        {/* Slide-over panel (comments or links) */}
        {/* Backdrop on mobile */}
        {openPanel && (
          <div
            className="fixed inset-0 bg-black/40 z-30 lg:hidden"
            onClick={() => setOpenPanel(null)}
          />
        )}

        {/* Panel container */}
        <div
          className={`
            fixed right-0 top-0 bottom-0 z-40
            lg:relative lg:z-auto
            w-[85vw] sm:w-80 lg:w-80
            bg-neutral-950 border-l border-neutral-800
            transform transition-transform duration-200 ease-out
            ${openPanel ? "translate-x-0" : "translate-x-full lg:hidden"}
            flex flex-col
          `}
        >
          {/* Panel header with close button */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 lg:hidden">
            <h2 className="text-sm font-semibold text-neutral-300">
              {openPanel === "comments" ? "Comments" : "Share Links"}
            </h2>
            <button
              onClick={() => setOpenPanel(null)}
              aria-label="Close panel"
              className="p-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 transition-colors touch-manipulation"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {openPanel === "comments" && canComment && (
              <Suspense fallback={<div className="p-4"><Spinner context="panel-comments" /></div>}>
                <CommentSidebar
                  documentId={doc.id}
                  tokenKey={tokenKey}
                  canComment={canComment}
                  canResolve={editable}
                  pendingAnchor={pendingAnchor}
                  onClearSelection={() => setPendingAnchor(null)}
                  comments={comments}
                  onCommentsChange={sync.refreshComments}
                  activeCommentId={activeCommentId}
                  onActiveCommentChange={setActiveCommentId}
                  displayName={displayName}
                  onChangeDisplayName={setDisplayName}
                  onAfterOwnPost={markSeen}
                  onClosePanel={() => setOpenPanel(null)}
                />
              </Suspense>
            )}
            {openPanel === "links" && permission === "admin" && (
              <Suspense fallback={<div className="p-4"><Spinner context="panel-links" /></div>}>
                <LinkManager documentId={doc.id} adminKey={tokenKey} documentExpiresAt={doc.expires_at} />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
