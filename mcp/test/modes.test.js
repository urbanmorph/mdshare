// The two modes, run as a real process: no arguments off a terminal is the MCP server (as every
// client config starts it), a command is the CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = fileURLToPath(new URL("../index.js", import.meta.url));

function start(args, env = {}) {
  return spawn(process.execPath, [ENTRY, ...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
}

function rpc(child, messages) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const replies = [];
    const want = messages.filter((m) => m.id !== undefined).length;
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        replies.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
        if (replies.length === want) {
          child.kill();
          resolve(replies);
        }
      }
    });
    child.on("error", reject);
    setTimeout(() => {
      child.kill();
      reject(new Error("no reply in 10 s"));
    }, 10_000);
    for (const m of messages) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  });
}

test("no arguments (stdin not a terminal) runs the MCP server with all 15 tools", async () => {
  const child = start([], { HOME: await mkdtemp(join(tmpdir(), "mdshare-mode-")) });
  const [init, list] = await rpc(child, [
    { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
    { method: "notifications/initialized" },
    { id: 2, method: "tools/list" },
  ]);
  assert.equal(init.result.serverInfo.name, "mdshare");
  assert.equal(list.result.tools.length, 15);
  assert.ok(list.result.tools.some((t) => t.name === "upload_markdown"));
});

test("`serve` is the same server", async () => {
  const child = start(["serve"]);
  const [init] = await rpc(child, [
    { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
  ]);
  assert.equal(init.result.serverInfo.name, "mdshare");
});

test("a command runs the CLI and exits with its code", async () => {
  const child = start(["--version"]);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const code = await new Promise((r) => child.on("close", r));
  assert.equal(code, 0);
  assert.match(out, /^mdshare-mcp \d+\.\d+\.\d+/);
});
