import { test } from "node:test";
import assert from "node:assert/strict";
import { responseError } from "./response-error.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("the server's own error message is shown when there is one", async () => {
  assert.equal(await responseError(json(400, { error: "Label is too long" }), "Failed"), "Label is too long");
});

test("a non-JSON error body falls back instead of throwing", async () => {
  assert.equal(
    await responseError(new Response("<html>502</html>", { status: 502 }), "Failed to create link"),
    "Failed to create link",
  );
  assert.equal(await responseError(json(400, { error: 42 }), "Failed"), "Failed");
});

test("expired, missing and rate-limited get plain words when the body says nothing", async () => {
  assert.match(await responseError(new Response("", { status: 410 }), "Failed"), /expired/);
  assert.match(await responseError(new Response("", { status: 404 }), "Failed"), /not found/i);
  assert.match(await responseError(new Response("", { status: 429 }), "Failed"), /too many/i);
});
