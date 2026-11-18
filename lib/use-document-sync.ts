import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Comment } from "../components/editor/comment-sidebar";
import type { SaveOptions } from "../components/editor/debounced-save";
import { useDocumentWS } from "./use-document-ws.ts";
import { apiUrl } from "./api-url.ts";
import { settlesToReady, type SaveStatus } from "./save-status.ts";
import { createTitleFlasher } from "./title-flash.ts";
import { keepIfUnchanged, fitsKeepalive, authorHeader } from "./sync-helpers.ts";

const POLL_MS = 15000;
const STATUS_MS = 2000;

interface Options {
  documentId: string;
  tokenKey: string;
  initialContent: string;
  initialHash: string;
  /** Comment and edit links show the editor, which reports when remote content is applied. */
  usesEditor: boolean;
  displayName: string;
}

interface PollResponse {
  content_hash: string;
  content?: string;
  comments: Comment[];
  viewers: { name: string }[];
}

/**
 * Keeps a document in step with the server: saves, live updates over the socket, the 15 s
 * poll for comments and viewers, and edit conflicts.
 *
 * The socket carries content in steady state. The poll pulls content only while the socket
 * is down or after a reconnect, when a broadcast may have been missed.
 */
export function useDocumentSync({ documentId, tokenKey, initialContent, initialHash, usesEditor, displayName }: Options) {
  const [liveContent, setLiveContent] = useState(initialContent);
  const [comments, setComments] = useState<Comment[]>([]);
  const [viewers, setViewers] = useState<{ name: string }[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("Ready");
  // The user's edit that a newer version overtook, kept so it is not lost.
  const [conflictDraft, setConflictDraft] = useState<string | null>(null);
  // Content from elsewhere is numbered; the editor reports which number it shows.
  const [contentRevision, setContentRevision] = useState(0);
  const remoteRef = useRef({ revision: 0, hash: initialHash });
  // The version this tab's editor actually shows. It is sent as the base of every save,
  // so it only moves forward once content is applied.
  const baseHashRef = useRef(initialHash);
  const savingRef = useRef(false);
  // Saves run one after another, so each is based on the hash the previous one returned.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const forceContentSyncRef = useRef(false);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flasherRef = useRef<ReturnType<typeof createTitleFlasher> | null>(null);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2));

  useEffect(() => {
    const flasher = createTitleFlasher(document);
    flasherRef.current = flasher;
    return () => {
      flasher.dispose();
      clearTimeout(statusTimerRef.current);
    };
  }, []);

  const showStatus = useCallback((status: SaveStatus) => {
    clearTimeout(statusTimerRef.current);
    setSaveStatus(status);
    if (settlesToReady(status)) statusTimerRef.current = setTimeout(() => setSaveStatus("Ready"), STATUS_MS);
  }, []);

  /** Show content saved elsewhere. `announce` says "Updated" in the status bar and the tab title. */
  const applyRemote = useCallback(
    (content: string, contentHash: string, announce = true) => {
      const revision = remoteRef.current.revision + 1;
      remoteRef.current = { revision, hash: contentHash };
      setLiveContent(content);
      setContentRevision(revision);
      // The read-only viewer renders the latest content directly.
      if (!usesEditor) baseHashRef.current = contentHash;
      if (announce) {
        showStatus("Updated");
        flasherRef.current?.flash();
      }
    },
    [usesEditor, showStatus]
  );

  const handleContentApplied = useCallback((revision: number) => {
    if (revision === remoteRef.current.revision) baseHashRef.current = remoteRef.current.hash;
  }, []);

  const { status: wsStatus, reconnects } = useDocumentWS({
    documentId,
    tokenKey,
    onContentUpdate: (content, contentHash) => {
      // Our own save echoed back, or an update racing our in-flight save. If it was
      // someone else's, our base hash is now stale and the next save gets a 409, so
      // nothing is overwritten.
      if (savingRef.current || contentHash === baseHashRef.current) return;
      applyRemote(content, contentHash);
    },
  });

  const poll = useEffectEvent(async () => {
    if (savingRef.current) return;
    const wantContent = wsStatus !== "live" || forceContentSyncRef.current;
    try {
      const res = await fetch(apiUrl(`/api/d/${documentId}/poll`, tokenKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          name: displayName,
          content_hash: wantContent ? baseHashRef.current : undefined,
        }),
      });
      if (!res.ok) return; // leave the catch-up flag set; the next tick retries
      forceContentSyncRef.current = false;
      const data = (await res.json()) as PollResponse;
      // Unchanged lists keep their identity, so nothing re-renders.
      setViewers((prev) => keepIfUnchanged(prev, data.viewers));
      setComments((prev) => keepIfUnchanged(prev, data.comments));
      if (wantContent && data.content && data.content_hash !== baseHashRef.current) {
        applyRemote(data.content, data.content_hash);
      }
    } catch {
      // Polling failures are recoverable; the next tick will retry.
    }
  });

  useEffect(() => {
    poll();
    const interval = setInterval(() => {
      if (!document.hidden) poll();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [documentId, tokenKey]);

  // One content resync each time the socket recovers.
  useEffect(() => {
    if (reconnects === 0) return;
    forceContentSyncRef.current = true;
    poll();
  }, [reconnects]);

  /** Fetch comments now, after posting one, instead of waiting for the poll. */
  const refreshComments = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/d/${documentId}/comments`, tokenKey));
      if (!res.ok) return;
      const data = (await res.json()) as { comments: Comment[] };
      setComments((prev) => keepIfUnchanged(prev, data.comments));
    } catch {
      // the poll catches up
    }
  }, [documentId, tokenKey]);

  const put = useCallback(
    async (markdown: string, opts?: SaveOptions) => {
      setLiveContent(markdown);
      showStatus("Saving...");
      savingRef.current = true;
      try {
        const res = await fetch(apiUrl(`/api/d/${documentId}`, tokenKey), {
          method: "PUT",
          // Lets the save finish after the tab closes; browsers cap keepalive bodies at 64 KiB.
          keepalive: !!opts?.keepalive && fitsKeepalive(markdown),
          headers: {
            "Content-Type": "text/markdown",
            "X-Edited-Via": "browser",
            "X-Author": authorHeader(displayName),
            // The version this edit was made on. A newer version on the server
            // means this tab missed it; the server answers 409 instead of overwriting.
            "X-Base-Hash": baseHashRef.current,
          },
          body: markdown,
        });
        if (res.status === 409) {
          const latest = (await res.json()) as { content: string; content_hash: string };
          setConflictDraft(markdown);
          applyRemote(latest.content, latest.content_hash, false);
          showStatus("Not saved: newer version loaded");
          return;
        }
        if (!res.ok) {
          showStatus("Save failed");
          return;
        }
        const data = (await res.json()) as { status: string; content_hash?: string };
        // The server broadcasts the saved content to the other tabs.
        if (data.content_hash) baseHashRef.current = data.content_hash;
        showStatus(data.status === "unchanged" ? "No changes" : "Saved");
      } catch {
        showStatus("Save failed");
      } finally {
        savingRef.current = false;
      }
    },
    [documentId, tokenKey, displayName, applyRemote, showStatus]
  );

  const save = useCallback(
    (markdown: string, opts?: SaveOptions) => {
      saveQueueRef.current = saveQueueRef.current.then(() => put(markdown, opts));
    },
    [put]
  );

  const dismissConflict = useCallback(() => setConflictDraft(null), []);

  return {
    liveContent,
    contentRevision,
    handleContentApplied,
    save,
    saveStatus,
    conflictDraft,
    dismissConflict,
    comments,
    refreshComments,
    viewers,
    wsStatus,
  };
}
