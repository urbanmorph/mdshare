import { test } from "node:test";
import assert from "node:assert/strict";
import { createCopier, writeClipboard, type CopyStatus } from "./use-copy.ts";

// The "Copied!" flash behind every copy button (lib/use-copy.ts). The React hook is a thin
// wrapper; this tests its timer and failure logic with a fake clock.

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (id: number | undefined) => void (id !== undefined && timers.delete(id)),
    tick(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

function setup(write: (text: string) => Promise<boolean>) {
  const clock = fakeClock();
  const seen: (CopyStatus | null)[] = [];
  const copier = createCopier(write, (s) => seen.push(s), 2000, clock);
  return { clock, seen, copier };
}

test("a copy flashes its id, then clears after the delay", async () => {
  const { clock, seen, copier } = setup(async () => true);
  assert.equal(await copier.copy("hello", "url"), true);
  assert.deepEqual(seen, [{ id: "url", ok: true }]);
  clock.tick(1999);
  assert.equal(seen.length, 1);
  clock.tick(1);
  assert.equal(seen.at(-1), null);
});

test("a clipboard failure is reported, not thrown", async () => {
  const { seen, copier } = setup(async () => false);
  assert.equal(await copier.copy("hello", "key"), false);
  assert.deepEqual(seen, [{ id: "key", ok: false }]);
});

test("a second copy restarts the timer instead of being cut short by the first", async () => {
  const { clock, seen, copier } = setup(async () => true);
  await copier.copy("a", "a");
  clock.tick(1500);
  await copier.copy("b", "b");
  assert.equal(clock.pending(), 1);
  clock.tick(1000);
  assert.deepEqual(seen.at(-1), { id: "b", ok: true });
  clock.tick(1000);
  assert.equal(seen.at(-1), null);
});

test("dispose (unmount) clears the timer, and a copy that finishes later changes nothing", async () => {
  const { clock, seen, copier } = setup(async () => true);
  await copier.copy("first", "x");
  copier.dispose();
  assert.equal(clock.pending(), 0);
  await copier.copy("late", "y");
  assert.deepEqual(seen, [{ id: "x", ok: true }]);
  assert.equal(clock.pending(), 0);
});

test("writeClipboard resolves false when the clipboard is missing or refuses", async () => {
  assert.equal(await writeClipboard("t", undefined), false);
  assert.equal(await writeClipboard("t", { writeText: () => Promise.reject(new Error("denied")) }), false);
  assert.equal(await writeClipboard("t", { writeText: () => { throw new Error("sync"); } }), false);
  let got = "";
  assert.equal(await writeClipboard("t", { writeText: async (s: string) => void (got = s) }), true);
  assert.equal(got, "t");
});
