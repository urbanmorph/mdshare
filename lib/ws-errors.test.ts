import { test } from "node:test";
import assert from "node:assert/strict";
import { isSessionGone, logUrl, sendAll } from "./ws-errors.ts";

// A document's live session (a Durable Object) can go away under an open connection when
// Cloudflare restarts it: a deploy, or its own maintenance. Seen on mdshare.live, Oct 2026:
// "Network connection lost." on a WebSocket upgrade, "this Durable Object instance is no
// longer active" and "internal error; reference = …" on close. The browser reconnects, so
// these are a retry, not a crash.

const err = (message: string, flags: Record<string, boolean> = {}) => Object.assign(new Error(message), flags);

test("a live session restarted under the request is a retry", () => {
  assert.equal(isSessionGone(err("Network connection lost.")), true);
  assert.equal(isSessionGone(err("Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.")), true);
  assert.equal(isSessionGone(err("anything", { retryable: true })), true);      // Cloudflare marks these itself
  assert.equal(isSessionGone(err("anything", { overloaded: true })), true);
});

test("anything else is a real failure", () => {
  assert.equal(isSessionGone(err("Cannot read properties of undefined (reading 'permission')")), false);
  assert.equal(isSessionGone(err("D1_ERROR: no such table: links")), false);
  assert.equal(isSessionGone("Network connection lost."), false);              // not an Error
  assert.equal(isSessionGone(undefined), false);
});

test("a logged URL never carries its share key", () => {
  assert.equal(logUrl("https://mdshare.live/api/ws/abc?key=cmt_secret&permission=comment"), "https://mdshare.live/api/ws/abc");
  assert.equal(logUrl("not a url"), "(unparseable url)");
});

test("one socket that can't take a message doesn't stop the others, or throw", () => {
  const got: string[] = [];
  const sock = (name: string, open = true, fails = false) => ({
    readyState: open ? 1 : 3,
    send(m: string) { if (fails) throw new Error("closing"); got.push(`${name}:${m}`); },
  });
  const a = sock("a"), b = sock("b", true, true), c = sock("c", false), d = sock("d");
  assert.equal(sendAll([a, b, c, d], "hi", a), 1);                             // a is the sender, b throws, c is closed
  assert.deepEqual(got, ["d:hi"]);
});
