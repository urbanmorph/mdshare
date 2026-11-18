import { useState, useCallback, useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { apiUrl } from "@/lib/api-url";
import { permissionBadgeClass } from "@/lib/permission-style";
import { responseError } from "@/lib/response-error";
import { useCopy } from "@/lib/use-copy";
import { linkUrl, linksUrl } from "./link-api";

interface LinkItem {
  id: string;
  permission: string;
  label: string | null;
  is_active: number;
  expires_at: string | null;
  created_at: string;
  url: string | null;
}

interface LinkManagerProps {
  documentId: string;
  adminKey: string;
  documentExpiresAt?: string | null;
}

const OFFLINE = "Couldn't reach mdshare. Check your connection and try again.";
const JSON_HEADERS = { "Content-Type": "application/json" };

type LinksResult = { links: LinkItem[] } | { error: string };

async function loadLinks(documentId: string, adminKey: string): Promise<LinksResult> {
  try {
    const res = await fetch(linksUrl(documentId, adminKey));
    if (!res.ok) return { error: await responseError(res, "Couldn't load share links.") };
    return { links: ((await res.json()) as { links: LinkItem[] }).links };
  } catch {
    return { error: OFFLINE };
  }
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in the viewer's local time.
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Document expiry may be set from a minute from now up to a year out. */
function expiryBounds() {
  const now = Date.now();
  return {
    min: toLocalInput(new Date(now + 60_000)),
    max: toLocalInput(new Date(now + 365 * 24 * 60 * 60 * 1000)),
  };
}

export function LinkManager({ documentId, adminKey, documentExpiresAt }: LinkManagerProps) {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [docExpiry, setDocExpiry] = useState<string | null>(documentExpiresAt ?? null);
  const [newDocExpiry, setNewDocExpiry] = useState("");
  const [expiryLimits] = useState(expiryBounds);
  const [savingExpiry, setSavingExpiry] = useState(false);
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const [expirySaved, setExpirySaved] = useState(false);
  const [newPerm, setNewPerm] = useState<"view" | "edit" | "comment">("view");
  const [newLabel, setNewLabel] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminKeyRevealed, setAdminKeyRevealed] = useState(false);
  const { copy, copied, label: copyLabel } = useCopy();

  const showLinks = useCallback((r: LinksResult) => {
    if ("links" in r) {
      setLinks(r.links);
      setListError(null);
    } else {
      setListError(r.error);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    let live = true;
    loadLinks(documentId, adminKey).then((r) => {
      if (live) showLinks(r);
    });
    return () => {
      live = false;
    };
  }, [documentId, adminKey, showLinks]);

  const refreshLinks = async () => showLinks(await loadLinks(documentId, adminKey));

  const createLink = async () => {
    const expires = newExpiry ? new Date(newExpiry) : null;
    if (expires && Number.isNaN(expires.getTime())) {
      setError("Pick a valid expiry date.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(linksUrl(documentId, adminKey), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          permission: newPerm,
          label: newLabel || null,
          expires_at: expires ? expires.toISOString() : null,
        }),
      });
      if (!res.ok) {
        setError(await responseError(res, "Failed to create link"));
        return;
      }
      const data = (await res.json()) as { url: string };
      setNewLabel("");
      setNewExpiry("");
      if (!(await copy(data.url, "new"))) {
        setError("Link created, but it couldn't be copied. Use Copy Link above.");
      }
      await refreshLinks();
      // The newest link is first in the list.
      setTimeout(() => {
        document.querySelector("[data-newest-link]")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch {
      setError(OFFLINE);
    } finally {
      setCreating(false);
    }
  };

  // Revoke, re-activate or delete one link (by id, so a revoked link can come back), then reload.
  const changeLink = async (link: LinkItem, init: RequestInit, failure: string) => {
    setBusyId(link.id);
    setListError(null);
    try {
      const res = await fetch(linkUrl(link, adminKey), init);
      if (!res.ok) {
        setListError(await responseError(res, failure));
        return;
      }
      await refreshLinks();
    } catch {
      setListError(OFFLINE);
    } finally {
      setBusyId(null);
    }
  };
  const setActive = (link: LinkItem, active: boolean) =>
    changeLink(
      link,
      { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ is_active: active }) },
      active ? "Couldn't re-activate the link." : "Couldn't revoke the link."
    );
  const deleteLink = (link: LinkItem) =>
    changeLink(link, { method: "DELETE" }, "Couldn't delete the link.");

  const updateExpiry = async () => {
    if (!newDocExpiry) return;
    const when = new Date(newDocExpiry);
    if (Number.isNaN(when.getTime())) {
      setExpiryError("Pick a valid date.");
      return;
    }
    setSavingExpiry(true);
    setExpiryError(null);
    try {
      const iso = when.toISOString();
      const res = await fetch(apiUrl(`/api/d/${encodeURIComponent(documentId)}/expiry`, adminKey), {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ expires_at: iso }),
      });
      if (!res.ok) {
        setExpiryError(await responseError(res, "Failed to update expiry"));
        return;
      }
      const data = (await res.json()) as { expires_at?: string };
      setDocExpiry(data.expires_at ?? iso);
      setNewDocExpiry("");
      setExpirySaved(true);
      setTimeout(() => setExpirySaved(false), 2000);
    } catch {
      setExpiryError(OFFLINE);
    } finally {
      setSavingExpiry(false);
    }
  };

  const smallButton = "px-2 py-1.5 text-xs rounded transition-colors disabled:opacity-50";
  const plainButton = `${smallButton} bg-neutral-800 hover:bg-neutral-700 text-neutral-300`;
  const copyButton = (id: string) =>
    `${smallButton} ${copied(id) ? "bg-green-800 text-green-200" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"}`;
  const dangerButton = `${smallButton} bg-red-900/50 hover:bg-red-800/60 text-red-300`;

  return (
    <div className="w-full bg-neutral-950 p-4 overflow-y-auto h-full">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-4">
        Share Links
      </h2>

      {/* Document expiry — admin-only; future dates only, up to 1 year out. */}
      <div className="bg-neutral-900 rounded-lg p-3 mb-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
          Document expiry
        </h3>
        <p className="text-[11px] text-neutral-400 mb-2">
          {docExpiry
            ? `Auto-deletes ${new Date(docExpiry).toLocaleString()}`
            : "No expiry set"}
        </p>
        <input
          type="datetime-local"
          value={newDocExpiry}
          min={expiryLimits.min}
          max={expiryLimits.max}
          onChange={(e) => setNewDocExpiry(e.target.value)}
          aria-label="New document expiry date"
          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-neutral-300 touch-manipulation [color-scheme:dark] mb-2"
        />
        <button
          onClick={updateExpiry}
          disabled={savingExpiry || !newDocExpiry}
          className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 text-xs font-medium rounded-lg transition-colors touch-manipulation"
        >
          {savingExpiry ? "Saving…" : expirySaved ? "Updated ✓" : "Update expiry"}
        </button>
        <p className="text-[11px] text-neutral-400 mt-1.5">
          Future dates only (up to 1 year). Set a nearer date to delete sooner.
        </p>
        {expiryError && (
          <p role="alert" className="text-[11px] text-red-400 mt-1.5">{expiryError}</p>
        )}
      </div>

      {/* Links list */}
      {listError && (
        <p role="alert" className="text-[11px] text-red-400 mb-2">{listError}</p>
      )}
      <div className="space-y-2 mb-4">
        {links.map((link, i) => {
          const busy = busyId === link.id;

          return (
            <div
              key={link.id}
              className="bg-neutral-900 rounded-lg p-3"
              {...(i === 0 ? { "data-newest-link": "" } : {})}
            >
              <div className={`flex items-center justify-between mb-1.5 ${!link.is_active ? "opacity-60" : ""}`}>
                <span className={`text-xs text-neutral-300 font-medium truncate ${!link.is_active ? "line-through" : ""}`}>
                  {link.label || "Untitled"}
                </span>
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded uppercase font-semibold shrink-0 ml-2 ${permissionBadgeClass(link.permission)}`}
                >
                  {link.permission}
                </span>
              </div>

              {link.is_active ? (
                <div className="flex gap-1.5">
                  {link.url && (
                    <button
                      onClick={() => copy(link.url!, link.id)}
                      className={`flex-1 ${copyButton(link.id)}`}
                    >
                      {copyLabel(link.id, "Copy Link")}
                    </button>
                  )}
                  <button
                    onClick={() => setActive(link, false)}
                    disabled={busy}
                    className={dangerButton}
                  >
                    {busy ? "..." : "Revoke"}
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setActive(link, true)}
                    disabled={busy}
                    className={`flex-1 ${plainButton}`}
                  >
                    {busy ? "..." : "Re-activate"}
                  </button>
                  <button
                    onClick={() => deleteLink(link)}
                    disabled={busy}
                    className={dangerButton}
                  >
                    Delete
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between mt-1.5 flex-wrap gap-1">
                <span className="text-[11px] text-neutral-400">
                  {new Date(link.created_at).toLocaleDateString()}
                </span>
                <div className="flex gap-1.5">
                  {link.expires_at && (
                    <span className={`text-[11px] ${
                      new Date(link.expires_at) < new Date()
                        ? "text-red-400"
                        : "text-amber-500"
                    }`}>
                      {new Date(link.expires_at) < new Date()
                        ? "Expired"
                        : `Expires ${new Date(link.expires_at).toLocaleDateString()}`}
                    </span>
                  )}
                  {!link.is_active && (
                    <span className="text-[11px] text-red-400">Revoked</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {loaded && !listError && links.length === 0 && (
          <p className="text-xs text-neutral-400 text-center py-2">
            Generate links and collaborate with others by sharing it
          </p>
        )}
      </div>

      {/* Create new link */}
      <div className="border-t border-neutral-800 pt-4">
        <h3 className="text-xs font-semibold text-neutral-400 mb-2">
          Generate New Link
        </h3>
        <select
          value={newPerm}
          onChange={(e) =>
            setNewPerm(e.target.value as "view" | "edit" | "comment")
          }
          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-neutral-300 mb-2 touch-manipulation"
        >
          <option value="view">View only</option>
          <option value="edit">Edit</option>
          <option value="comment">Comment</option>
        </select>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (optional)"
          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-neutral-300 placeholder-neutral-600 mb-2 touch-manipulation"
        />
        <label className="block mb-2">
          <span className="text-[11px] text-neutral-400 mb-1 block">Link expires (default: 90 days with document)</span>
          <input
            type="datetime-local"
            value={newExpiry}
            onChange={(e) => setNewExpiry(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-neutral-300 touch-manipulation [color-scheme:dark]"
          />
        </label>
        <button
          onClick={createLink}
          disabled={creating}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white text-sm font-medium rounded-lg transition-colors touch-manipulation"
        >
          {creating ? <Spinner context="link" /> : "Generate Link"}
        </button>
        {error && (
          <p role="alert" className="text-[11px] text-red-400 mt-2 text-center">{error}</p>
        )}
        <p className="text-[11px] text-neutral-400 mt-2 text-center">
          {copied("new") ? "Copied to clipboard" : "Auto-copied to clipboard on creation"}
        </p>
      </div>

      {adminKey && (
        <div className="border-t border-neutral-800 pt-4 mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
            For Developers &amp; AI Agents
          </h3>
          <label className="block text-xs text-neutral-400 mb-1.5">Admin key</label>
          <div className="flex gap-1.5">
            <input
              type="text"
              readOnly
              value={adminKeyRevealed ? adminKey : `adm_${"•".repeat(24)}`}
              onFocus={(e) => e.currentTarget.blur()}
              className="flex-1 min-w-0 bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-400 truncate focus:outline-none"
            />
            <button
              onClick={() => setAdminKeyRevealed((v) => !v)}
              aria-label={adminKeyRevealed ? "Hide admin key" : "Reveal admin key"}
              className={plainButton}
            >
              {adminKeyRevealed ? "Hide" : "Show"}
            </button>
            <button onClick={() => copy(adminKey, "admin-key")} className={copyButton("admin-key")}>
              {copyLabel("admin-key", "Copy")}
            </button>
          </div>
          <p className="text-[11px] text-neutral-400 leading-relaxed mt-2">
            Use this in Claude, Cursor, or the mdshare MCP server to edit this document from AI tools.{" "}
            <span className="text-amber-500/80">Full control</span> — anyone with this key can edit or delete the document. Don&apos;t paste it into public chats.{" "}
            <a
              href="/share-markdown-with-ai"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
            >
              How to use →
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
