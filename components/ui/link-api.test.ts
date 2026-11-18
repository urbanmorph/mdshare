import { test } from "node:test";
import assert from "node:assert/strict";
import { linkUrl, linksUrl } from "./link-api.ts";

// Share links are addressed by their id, so tokens stay out of URL paths and logs, and a
// revoked link (whose token no longer resolves) can still be re-activated or deleted.

test("a link action goes to /api/links/<id>, never the token", () => {
  const link = { id: "abc123", token: "vw_secret" }; // as GET /api/d/:id/links returns it
  const url = linkUrl(link, "adm_key");
  assert.equal(url, "/api/links/abc123?key=adm_key");
  assert.doesNotMatch(url, /vw_secret/);
});

test("ids and keys are escaped", () => {
  assert.equal(linkUrl({ id: "a/b" }, "k&x=1"), "/api/links/a%2Fb?key=k%26x%3D1");
  assert.equal(linksUrl("doc 1", "k&x"), "/api/d/doc%201/links?key=k%26x");
});
