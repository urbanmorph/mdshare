import { apiUrl } from "../../lib/api-url.ts";

/** A document's share-link list (GET) and where new links are made (POST). */
export const linksUrl = (documentId: string, adminKey: string) =>
  apiUrl(`/api/d/${encodeURIComponent(documentId)}/links`, adminKey);

/** One share link, by id (not its token), for PATCH (revoke, re-activate) and DELETE. */
export const linkUrl = (link: { id: string }, adminKey: string) =>
  apiUrl(`/api/links/${encodeURIComponent(link.id)}`, adminKey);
