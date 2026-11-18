import { test, after } from "node:test";
import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "https://mdshare.test/d/abc" });

// A WebSocket that records what the hook does with it.
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) { this.url = url; FakeSocket.all.push(this); }
  send(s: string) { this.sent.push(s); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}
(globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
// React's act() needs this flag outside a test framework that sets it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { useDocumentWS } = await import("./use-document-ws.ts");

after(() => GlobalRegistrator.unregister());

function mount(onUpdate: (c: string, h: string) => void) {
  const seen: { status: string; reconnects: number }[] = [];
  function Probe() {
    const r = useDocumentWS({ documentId: "abc", tokenKey: "k&y", onContentUpdate: onUpdate });
    seen.push(r);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  React.act(() => root.render(React.createElement(Probe)));
  return { root, seen };
}

test("connects with an escaped key, delivers updates, and stops for good on unmount", async () => {
  FakeSocket.all = [];
  const updates: string[] = [];
  const { root, seen } = mount((c) => updates.push(c));
  assert.equal(FakeSocket.all.length, 1);
  const ws = FakeSocket.all[0];
  assert.equal(ws.url, "wss://mdshare.test/api/ws/abc?key=k%26y");
  React.act(() => ws.open());
  assert.equal(seen.at(-1)!.status, "live");
  React.act(() => ws.onmessage!({ data: JSON.stringify({ type: "update", content: "new", content_hash: "h" }) }));
  assert.deepEqual(updates, ["new"]);

  React.act(() => root.unmount());
  await new Promise((r) => setTimeout(r, 3500));
  assert.equal(FakeSocket.all.length, 1, "unmount must not schedule a reconnect");
});

test("a drop reconnects and counts the reconnect; the client never sends content", async () => {
  FakeSocket.all = [];
  const { root, seen } = mount(() => {});
  React.act(() => FakeSocket.all[0].open());
  React.act(() => FakeSocket.all[0].close());
  assert.equal(seen.at(-1)!.status, "reconnecting");
  await React.act(() => new Promise((r) => setTimeout(r, 3100)));
  assert.equal(FakeSocket.all.length, 2);
  React.act(() => FakeSocket.all[1].open());
  assert.equal(seen.at(-1)!.reconnects, 1);
  for (const ws of FakeSocket.all) for (const s of ws.sent) assert.notEqual(JSON.parse(s).type, "update");
  React.act(() => root.unmount());
});
