import { useState } from "react";
import { DownloadButton } from "../../components/ui/download-button";
import type { Permission } from "../../lib/tokens";
import { statusTone, type SaveStatus } from "../../lib/save-status";
import type { WSStatus } from "../../lib/use-document-ws";

// The document page's header, banners and status bar. State lives in DocumentView.

export type Panel = "comments" | "links";

const PERMISSION_LABELS: Record<Permission, string> = {
  admin: "Admin",
  edit: "Editing",
  comment: "Commenting",
  view: "View only",
};

const BADGE_COLORS: Record<Permission, string> = {
  admin: "bg-purple-600",
  edit: "bg-blue-600",
  comment: "bg-amber-600",
  view: "bg-neutral-600",
};

const panelButton = (open: boolean) =>
  `p-2 sm:px-3 sm:py-1.5 rounded-lg text-xs transition-colors ${
    open ? "bg-indigo-600 text-white" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
  }`;

export function DocumentHeader({
  title,
  content,
  permission,
  canComment,
  viewers,
  commentCount,
  unreadCount,
  openPanel,
  onTogglePanel,
}: {
  title: string;
  content: string;
  permission: Permission;
  canComment: boolean;
  viewers: { name: string }[];
  commentCount: number;
  unreadCount: number;
  openPanel: Panel | null;
  onTogglePanel: (panel: Panel) => void;
}) {
  return (
    <header className="flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3 border-b border-neutral-800 bg-neutral-950 gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <a href="/" className="text-base font-bold text-white shrink-0">
          md<span className="text-indigo-400">share</span>
        </a>
        <span className="text-neutral-700 hidden sm:inline">/</span>
        <span className="text-sm text-neutral-300 truncate hidden sm:inline">{title}</span>
        {viewers.length > 0 && (
          <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-green-400 shrink-0" title={viewers.map((v) => v.name).join(", ")}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {viewers.length === 1 ? viewers[0].name : `${viewers.length} online`}
          </span>
        )}
        <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-semibold text-white shrink-0 ${BADGE_COLORS[permission]}`}>
          {PERMISSION_LABELS[permission]}
        </span>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {canComment && (
          <button onClick={() => onTogglePanel("comments")} className={`relative ${panelButton(openPanel === "comments")}`} title="Toggle comments">
            <svg className="w-4 h-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <span className="hidden sm:inline">Comments</span>
            {commentCount > 0 && (
              <span
                className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold ${
                  unreadCount > 0
                    ? "bg-amber-500 text-white"
                    : openPanel === "comments"
                      ? "bg-white text-indigo-600"
                      : "bg-indigo-600 text-white"
                }`}
                title={unreadCount > 0 ? `${unreadCount} new since you last looked` : undefined}
              >
                {unreadCount > 0 ? unreadCount : commentCount}
              </span>
            )}
          </button>
        )}
        {permission === "admin" && (
          <button onClick={() => onTogglePanel("links")} className={panelButton(openPanel === "links")} title="Toggle share links">
            <svg className="w-4 h-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span className="hidden sm:inline">Links</span>
          </button>
        )}
        <DownloadButton content={content} title={title} />
        <a
          href="/about"
          className="p-2.5 rounded-lg text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800 transition-colors touch-manipulation"
          title="About mdshare"
          aria-label="About mdshare"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </a>
      </div>
    </header>
  );
}

export function NewDocBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 px-3 sm:px-5 py-2.5 bg-indigo-950/40 border-b border-indigo-900/60 text-xs sm:text-sm text-indigo-100">
      <svg className="w-4 h-4 mt-0.5 shrink-0 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
      </svg>
      <div className="flex-1 leading-relaxed">
        <span className="font-semibold">This page is your admin link — bookmark it.</span>{" "}
        <span className="text-indigo-200/80">
          Edit the <span className="font-mono">Untitled</span> heading below to rename. Your admin key for AI tools like Claude and Cursor is in the Share links panel.
        </span>
      </div>
      <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-indigo-300 hover:text-white transition-colors px-1">
        ×
      </button>
    </div>
  );
}

export function ConflictBanner({ draft, onDismiss }: { draft: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-2 px-3 sm:px-5 py-2.5 bg-amber-950/40 border-b border-amber-900/60 text-xs sm:text-sm text-amber-100">
      <div className="flex items-start gap-3">
        <div className="flex-1 leading-relaxed">
          <span className="font-semibold">This note changed while you were editing.</span>{" "}
          <span className="text-amber-200/80">
            The newer version is now loaded. Your last edit was not saved, so it is kept below. Copy what you need back into the note.
          </span>
        </div>
        <button
          onClick={() => {
            // The text stays selectable in the box below if the clipboard is blocked.
            navigator.clipboard?.writeText(draft).catch(() => {});
          }}
          className="shrink-0 px-2 py-1 rounded bg-amber-800/60 hover:bg-amber-700/60 text-amber-50 transition-colors"
        >
          Copy my edit
        </button>
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-amber-300 hover:text-white transition-colors px-1">
          ×
        </button>
      </div>
      <textarea
        readOnly
        value={draft}
        aria-label="Your unsaved edit"
        className="w-full h-28 p-2 rounded bg-neutral-950 border border-amber-900/60 text-neutral-200 font-mono text-xs"
      />
    </div>
  );
}

const TONE_DOT = { ok: "bg-green-400", busy: "bg-yellow-400", error: "bg-red-400" } as const;

export function StatusBar({
  saveStatus,
  wsStatus,
  wordCount,
  displayName,
  onChangeName,
}: {
  saveStatus: SaveStatus;
  wsStatus: WSStatus;
  wordCount: number;
  displayName: string;
  onChangeName: (name: string) => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 sm:px-5 py-1.5 border-t border-neutral-800 text-xs text-neutral-300 bg-neutral-950 gap-2">
      <span className="flex items-center gap-3 shrink-0">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${TONE_DOT[statusTone(saveStatus)]}`} />
          {saveStatus}
        </span>
        {wsStatus === "live" ? (
          <span className="hidden sm:flex items-center gap-1 text-neutral-400" title="Live — receiving updates in real time">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
            Live
          </span>
        ) : wsStatus === "connecting" ? (
          <span className="hidden sm:flex items-center gap-1 text-neutral-400" title="Connecting to live updates…">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-500 animate-pulse" />
            Connecting…
          </span>
        ) : (
          <span
            className="flex items-center gap-1 text-amber-400"
            title="Connection lost — reconnecting. Live updates are paused; the page will catch up automatically."
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Reconnecting…
          </span>
        )}
      </span>
      <span className="hidden sm:inline text-neutral-400">{wordCount} words</span>
      <DisplayNameEditor name={displayName} onChangeName={onChangeName} />
    </div>
  );
}

function DisplayNameEditor({ name, onChangeName }: { name: string; onChangeName: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (editing) {
    return (
      <span className="flex items-center gap-1 shrink-0">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onChangeName(draft);
              setEditing(false);
            }
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          onBlur={() => {
            onChangeName(draft);
            setEditing(false);
          }}
          className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-white w-28 sm:w-32 focus:outline-none focus:border-indigo-500 touch-manipulation"
          placeholder="Your name"
        />
      </span>
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      className="shrink-0 text-indigo-400 hover:text-indigo-300 transition-colors truncate max-w-[120px] sm:max-w-[150px] text-xs"
      title="Click to change your display name"
    >
      {name === "Anonymous" ? "Set name" : name}
    </button>
  );
}
