import { test } from "node:test";
import assert from "node:assert/strict";
import { documentSource } from "./document-source.ts";

const req = (h: Record<string, string> = {}) => ({
  contentType: h.contentType ?? "text/markdown",
  userAgent: h.userAgent ?? "",
  origin: h.origin ?? "",
  xSource: h.xSource ?? "",
});

test("the mdshare-mcp command line counts as cli, not mcp or api", () => {
  assert.equal(documentSource(req({ userAgent: "mdshare-cli/1.6.0" })), "cli");
});

test("the existing sources are unchanged", () => {
  assert.equal(documentSource(req({ contentType: "multipart/form-data; boundary=x" })), "upload");
  assert.equal(documentSource(req({ xSource: "blank" })), "blank");
  assert.equal(documentSource(req({ userAgent: "mdshare-mcp/1.5.0" })), "mcp");
  assert.equal(documentSource(req({ userAgent: "mdshare-vscode/0.3" })), "vscode");
  assert.equal(documentSource(req({ userAgent: "Mozilla/5.0 obsidian/1.8" })), "obsidian");
  assert.equal(documentSource(req({ origin: "https://mdshare.live" })), "paste");
  assert.equal(documentSource(req({ userAgent: "curl/8.4" })), "api");
});

test("only a User-Agent that starts with mdshare-cli/ counts", () => {
  assert.equal(documentSource(req({ userAgent: "my-bot (like mdshare-cli/1.0)" })), "api");
});
