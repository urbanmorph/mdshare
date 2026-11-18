
import { useState, useCallback } from "react";
import { safeGet, safeSet, safeRemove } from "./storage.ts";
import { LIMITS } from "./limits.ts";

const STORAGE_KEY = "mdshare_display_name";

/** A display name as stored and sent: trimmed, at most the API's author_name cap, "Anonymous" when empty. */
export function cleanDisplayName(raw: string | null): string {
  return (raw ?? "").trim().slice(0, LIMITS.authorName).trim() || "Anonymous";
}

export function useDisplayName() {
  // Read on first render (the island is client-only), so the name is right from the start.
  const [name, setNameState] = useState(() => cleanDisplayName(safeGet(STORAGE_KEY)));

  const setName = useCallback((newName: string) => {
    const trimmed = cleanDisplayName(newName);
    setNameState(trimmed);
    if (trimmed === "Anonymous") safeRemove(STORAGE_KEY);
    else safeSet(STORAGE_KEY, trimmed);
  }, []);

  return { name, setName };
}
