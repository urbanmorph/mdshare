
import { useState, useCallback } from "react";
import { safeGet, safeSet, safeRemove } from "./storage.ts";

const STORAGE_KEY = "mdshare_display_name";

export function useDisplayName() {
  // Read on first render (the island is client-only), so the name is right from the start.
  const [name, setNameState] = useState(() => safeGet(STORAGE_KEY) || "Anonymous");

  const setName = useCallback((newName: string) => {
    const trimmed = newName.trim() || "Anonymous";
    setNameState(trimmed);
    if (trimmed === "Anonymous") safeRemove(STORAGE_KEY);
    else safeSet(STORAGE_KEY, trimmed);
  }, []);

  return { name, setName };
}
