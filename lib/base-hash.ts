// Optimistic concurrency for document writes.
//
// A writer may name the content hash its edit was based on. If the document has
// moved on since, the write is stale and must not overwrite the newer content.
// Writers that send no base hash keep the old last-write-wins behaviour, so
// existing API and MCP clients are unaffected.

export const BASE_HASH_HEADER = "x-base-hash";

export function isStaleWrite(baseHash: string | null | undefined, currentHash: string): boolean {
  return !!baseHash && baseHash !== currentHash;
}
