#!/usr/bin/env node

// One package, two modes. With no arguments (how MCP clients start it) or `serve`, the stdio MCP
// server; with a command, the command line. No arguments on a terminal prints help instead of
// waiting for MCP messages that will never come.

const args = process.argv.slice(2);
if (args[0] === "serve" || (args.length === 0 && !process.stdin.isTTY)) {
  const { serve } = await import("./src/server.js");
  await serve();
} else {
  const { run } = await import("./src/cli.js");
  process.exitCode = await run(args);
}
