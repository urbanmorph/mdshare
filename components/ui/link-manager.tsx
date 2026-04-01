"use client";

import { useState, useCallback, useEffect } from "react";

interface LinkItem {
  id: string;
  permission: string;
  label: string | null;
  is_active: number;
  created_at: string;
  url: string | null;
}

interface LinkManagerProps {
  documentId: string;
  adminKey: string;
}

export function LinkManager({ documentId, adminKey }: LinkManagerProps) {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newPerm, setNewPerm] = useState<"view" | "edit" | "comment">("view");
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    const res = await fetch(`/api/d/${documentId}/links?key=${adminKey}`);
    if (res.ok) {
      const data = (await res.json()) as { links: LinkItem[] };
      setLinks(data.links);
      setLoaded(true);
    }
  }, [documentId, adminKey]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const createLink = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/d/${documentId}/links?key=${adminKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permission: newPerm,
          label: newLabel || null,
        }),
      });
      if (!res.ok) return;

      const data = (await res.json()) as { url: string };

      // Auto-copy the new link
      navigator.clipboard.writeText(data.url);
      setNewLabel("");

      // Refetch to get the updated list with URLs
      await fetchLinks();

      // Flash "Copied" on the newest link
      if (links.length >= 0) {
        // The newest will be first after refetch, use a small delay
        setTimeout(() => {
          const el = document.querySelector("[data-newest-link]");
          if (el) el.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
    } finally {
      setCreating(false);
    }
  };

  const copyUrl = (linkId: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(linkId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const permColor = (perm: string) => {
    switch (perm) {
      case "edit":
        return "bg-blue-900/50 text-blue-300";
      case "view":
        return "bg-neutral-800 text-neutral-400";
      case "comment":
        return "bg-amber-900/50 text-amber-300";
      default:
        return "bg-neutral-800 text-neutral-400";
    }
  };

  return (
    <div className="w-full bg-neutral-950 p-4 overflow-y-auto h-full">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-4">
        Share Links
      </h3>

      {/* Links list */}
      <div className="space-y-2 mb-4">
        {links.map((link, i) => {
          const isCopied = copiedId === link.id;

          return (
            <div
              key={link.id}
              className="bg-neutral-900 rounded-lg p-3"
              {...(i === 0 ? { "data-newest-link": "" } : {})}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-neutral-300 font-medium truncate">
                  {link.label || "Untitled"}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold shrink-0 ml-2 ${permColor(
                    link.permission
                  )}`}
                >
                  {link.permission}
                </span>
              </div>

              {link.url && (
                <button
                  onClick={() => copyUrl(link.id, link.url!)}
                  className={`w-full px-2 py-1.5 text-xs rounded transition-colors ${
                    isCopied
                      ? "bg-green-800 text-green-200"
                      : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                  }`}
                >
                  {isCopied ? "Copied!" : "Copy Link"}
                </button>
              )}

              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-neutral-700">
                  {new Date(link.created_at).toLocaleDateString()}
                </span>
                {!link.is_active && (
                  <span className="text-[10px] text-red-400">Revoked</span>
                )}
              </div>
            </div>
          );
        })}
        {loaded && links.length === 0 && (
          <p className="text-xs text-neutral-600 text-center py-2">
            No share links yet
          </p>
        )}
      </div>

      {/* Create new link */}
      <div className="border-t border-neutral-800 pt-4">
        <h4 className="text-xs font-semibold text-neutral-400 mb-2">
          Generate New Link
        </h4>
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
        <button
          onClick={createLink}
          disabled={creating}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white text-sm font-medium rounded-lg transition-colors touch-manipulation"
        >
          {creating ? "Creating..." : "Generate Link"}
        </button>
        <p className="text-[10px] text-neutral-600 mt-2 text-center">
          Auto-copied to clipboard on creation
        </p>
      </div>
    </div>
  );
}
