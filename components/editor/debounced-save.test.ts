import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDebouncedSave } from "./debounced-save.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

function setup() {
  let text = "a";
  const saves: { md: string; keepalive: boolean }[] = [];
  const saver = createDebouncedSave(() => text, (md, opts) => saves.push({ md, keepalive: !!opts?.keepalive }), 3000);
  return { saver, saves, type: (t: string) => { text = t; saver.schedule(); } };
}

test("saves once, 3 s after the last keystroke", () => {
  const { saver, saves, type } = setup();
  type("ab");
  mock.timers.tick(2000);
  type("abc");
  mock.timers.tick(2999);
  assert.deepEqual(saves, []);
  assert.ok(saver.pending());
  mock.timers.tick(1);
  assert.deepEqual(saves, [{ md: "abc", keepalive: false }]);
  assert.ok(!saver.pending());
});

test("flush saves a pending edit at once and cancels the timer", () => {
  const { saver, saves, type } = setup();
  type("ab");
  saver.flush({ keepalive: true });
  assert.deepEqual(saves, [{ md: "ab", keepalive: true }]);
  mock.timers.tick(5000);
  assert.equal(saves.length, 1, "no second save from the old timer");
});

test("flush with nothing pending does nothing", () => {
  const { saver, saves } = setup();
  saver.flush();
  assert.deepEqual(saves, []);
});

test("cancel drops the pending save", () => {
  const { saver, saves, type } = setup();
  type("ab");
  saver.cancel();
  mock.timers.tick(5000);
  assert.deepEqual(saves, []);
});
