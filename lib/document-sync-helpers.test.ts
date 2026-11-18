import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { statusTone, settlesToReady, type SaveStatus } from "./save-status.ts";
import { createTitleFlasher } from "./title-flash.ts";
import { keepIfUnchanged, fitsKeepalive, authorHeader } from "./sync-helpers.ts";
import { parseSqliteDate } from "./sqlite-date.ts";
import { countUnread } from "./lastseen.ts";
import { markdownFilename, downloadMarkdown } from "./download-markdown.ts";

test("every save status has a tone, and 'No changes' is not an error", () => {
  const all: SaveStatus[] = ["Ready", "Saving...", "Saved", "No changes", "Updated", "Save failed", "Not saved: newer version loaded"];
  assert.equal(statusTone("No changes"), "ok");
  assert.equal(statusTone("Saved"), "ok");
  assert.equal(statusTone("Saving..."), "busy");
  assert.equal(statusTone("Updated"), "busy");
  assert.equal(statusTone("Save failed"), "error");
  assert.equal(statusTone("Not saved: newer version loaded"), "error");
  for (const s of all) assert.ok(["ok", "busy", "error"].includes(statusTone(s)), s);
});

test("only the passing statuses settle back to Ready", () => {
  assert.ok(settlesToReady("Saved"));
  assert.ok(settlesToReady("No changes"));
  assert.ok(settlesToReady("Updated"));
  assert.ok(!settlesToReady("Save failed"));
  assert.ok(!settlesToReady("Saving..."));
});

test("two flashes within the delay still restore the original title", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const doc = { title: "Notes — mdshare" };
    const flasher = createTitleFlasher(doc, 3000);
    flasher.flash();
    assert.equal(doc.title, "Updated — Notes — mdshare");
    mock.timers.tick(1000);
    flasher.flash();
    mock.timers.tick(3000);
    assert.equal(doc.title, "Notes — mdshare");
    flasher.flash();
    flasher.dispose();
    assert.equal(doc.title, "Notes — mdshare", "dispose restores and cancels");
    mock.timers.tick(5000);
    assert.equal(doc.title, "Notes — mdshare");
  } finally {
    mock.timers.reset();
  }
});

test("an unchanged poll result keeps the previous array, so React skips the render", () => {
  const prev = [{ id: "a", resolved: 0 }, { id: "b", resolved: 0 }];
  const same = keepIfUnchanged(prev, [{ id: "a", resolved: 0 }, { id: "b", resolved: 0 }]);
  assert.equal(same, prev);
  const next = [{ id: "a", resolved: 1 }, { id: "b", resolved: 0 }];
  assert.equal(keepIfUnchanged(prev, next), next);
});

test("keepalive is used only for bodies under the browser's 64 KiB limit", () => {
  assert.ok(fitsKeepalive("short"));
  assert.ok(!fitsKeepalive("x".repeat(64 * 1024)));
  // Bytes, not characters: Devanagari is 3 bytes per character in UTF-8.
  assert.ok(!fitsKeepalive("स".repeat(22000)));
});

test("the author header is safe for fetch with any name", () => {
  const value = authorHeader("सत्य");
  assert.match(value, /^[\x20-\x7e]*$/, "must be a ByteString");
  assert.equal(decodeURIComponent(value), "सत्य");
  assert.doesNotThrow(() => new Headers({ "X-Author": value }));
});

test("SQLite timestamps without a zone are read as UTC", () => {
  assert.equal(parseSqliteDate("2026-01-02 03:04:05"), Date.parse("2026-01-02T03:04:05Z"));
  assert.equal(parseSqliteDate("2026-01-02T03:04:05.000Z"), Date.parse("2026-01-02T03:04:05Z"));
});

test("unread counts comments newer than lastseen, reading D1 times as UTC", () => {
  const comments = [{ created_at: "2026-01-02 10:00:00" }, { created_at: "2026-01-02 12:00:00" }];
  assert.equal(countUnread("2026-01-02T11:00:00.000Z", comments), 1);
  assert.equal(countUnread(null, comments), 0);
});

test("download filenames keep letters in any script", () => {
  assert.equal(markdownFilename("My notes: v2"), "My_notes__v2.md");
  assert.equal(markdownFilename("सत्य notes"), "सत्य_notes.md");
  assert.equal(markdownFilename("   "), "Untitled.md");
});

test("downloadMarkdown saves the given content without fetching", async () => {
  const clicked: { href: string; download: string }[] = [];
  const blobs: Blob[] = [];
  const env = {
    createElement: () => {
      const a = { href: "", download: "", click: () => clicked.push({ href: a.href, download: a.download }) };
      return a;
    },
    createObjectURL: (b: Blob) => { blobs.push(b); return "blob:1"; },
    revokeObjectURL: () => {},
  };
  downloadMarkdown("# Hi", "Hi", env);
  assert.deepEqual(clicked, [{ href: "blob:1", download: "Hi.md" }]);
  assert.equal(await blobs[0].text(), "# Hi");
});
