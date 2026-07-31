import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  MAX_ATTACHMENTS_PER_MESSAGE,
  isImageFile,
  formatAttachmentSize,
  createPendingAttachment,
  revokePendingAttachment,
  addPendingAttachments,
  removePendingAttachment,
  clearPendingAttachments,
} = await jiti.import("./pending-attachments.ts");

test("MAX_ATTACHMENTS_PER_MESSAGE is 10", () => {
  assert.equal(MAX_ATTACHMENTS_PER_MESSAGE, 10);
});

test("isImageFile routes by extension matching the server's IMAGE_EXTENSIONS list", () => {
  // The server's channel decision (lib/file-upload-policy.ts) is
  // extension-based because browser MIME sniffing is unreliable. The
  // client uses the same rule so the two never disagree.
  for (const name of ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.avif"]) {
    assert.equal(isImageFile({ name, type: "image/png" }), true, `${name} should be image`);
  }
  // Uppercase extension normalises via the shared getExtension helper.
  assert.equal(isImageFile({ name: "Photo.PNG", type: "image/png" }), true);
});

test("isImageFile returns false for non-image extensions even when the MIME says image/*", () => {
  // .svg is image/svg+xml in MIME-land but the server policy doesn't
  // classify it as image; extension wins. A bare { type } with no name
  // falls through to the path channel too.
  assert.equal(isImageFile({ name: "doc.svg", type: "image/svg+xml" }), false);
  // Extension still wins over an empty MIME — the exact case this rule
  // exists to rescue.
  assert.equal(isImageFile({ name: "shot.png", type: "" }), true);
  assert.equal(isImageFile({ name: "shot.png", type: "application/octet-stream" }), true);
  // No name at all → path channel.
  assert.equal(isImageFile({ type: "image/png" }), false);
});

test("isImageFile returns false for path-channel and unknown extensions", () => {
  for (const name of ["doc.pdf", "song.mp3", "data.zip", "thing.foo", "README"]) {
    assert.equal(isImageFile({ name, type: "application/octet-stream" }), false, `${name} should be path`);
  }
});

test("formatAttachmentSize rounds sensibly for chip display", () => {
  assert.equal(formatAttachmentSize(0), "0 B");
  assert.equal(formatAttachmentSize(512), "512 B");
  assert.equal(formatAttachmentSize(1024), "1.0 KB");
  assert.equal(formatAttachmentSize(12_345), "12.1 KB");
  assert.equal(formatAttachmentSize(2_500_000), "2.4 MB");
  assert.equal(formatAttachmentSize(50 * 1024 * 1024), "50 MB");
});

test("formatAttachmentSize tolerates invalid input", () => {
  assert.equal(formatAttachmentSize(Number.NaN), "0 B");
  assert.equal(formatAttachmentSize(-5), "0 B");
});

test("createPendingAttachment assigns a unique id and ready status", () => {
  const a = createPendingAttachment({ name: "a.txt", type: "text/plain" });
  const b = createPendingAttachment({ name: "b.txt", type: "text/plain" });
  assert.notEqual(a.id, b.id);
  assert.equal(a.status, "ready");
  assert.equal(b.status, "ready");
});

test("createPendingAttachment allocates a previewUrl only for image files", () => {
  // jsdom-less env: stub a global URL.createObjectURL if missing.
  const calls = [];
  const originalCreate = globalThis.URL?.createObjectURL;
  const originalRevoke = globalThis.URL?.revokeObjectURL;
  globalThis.URL.createObjectURL = (blob) => {
    calls.push(blob);
    return "blob:test://" + (calls.length);
  };
  globalThis.URL.revokeObjectURL = () => {};

  const img = createPendingAttachment({ name: "cat.png", type: "image/png" });
  const doc = createPendingAttachment({ name: "spec.pdf", type: "application/pdf" });
  const unknown = createPendingAttachment({ name: "mystery", type: "" });

  assert.match(img.previewUrl, /^blob:/);
  assert.equal(doc.previewUrl, "");
  assert.equal(unknown.previewUrl, "");
  assert.equal(calls.length, 1, "createObjectURL should only be called for image files");

  if (originalCreate) globalThis.URL.createObjectURL = originalCreate; else delete globalThis.URL.createObjectURL;
  if (originalRevoke) globalThis.URL.revokeObjectURL = originalRevoke; else delete globalThis.URL.revokeObjectURL;
});

test("revokePendingAttachment is safe for non-image attachments and empty URLs", () => {
  const calls = [];
  const originalRevoke = globalThis.URL?.revokeObjectURL;
  globalThis.URL.revokeObjectURL = (url) => calls.push(url);
  const img = { id: "x", file: {}, previewUrl: "blob:abc", status: "ready" };
  const doc = { id: "y", file: {}, previewUrl: "", status: "ready" };
  revokePendingAttachment(img);
  revokePendingAttachment(doc);
  assert.deepEqual(calls, ["blob:abc"]);
  if (originalRevoke) globalThis.URL.revokeObjectURL = originalRevoke; else delete globalThis.URL.revokeObjectURL;
});

test("addPendingAttachments appends up to the cap and reports dropped count", () => {
  const incoming = Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.txt`, type: "text/plain" }));
  const result = addPendingAttachments([], incoming);
  assert.equal(result.pending.length, 3);
  assert.equal(result.rejected, 0);
  assert.equal(result.rejectedReason, undefined);
});

test("addPendingAttachments enforces the 10-file cap with a clear reason", () => {
  const existing = Array.from({ length: 8 }, (_, i) => ({ id: `seed-${i}`, file: { name: `seed${i}` }, previewUrl: "", status: "ready" }));
  const incoming = [
    { name: "a.txt", type: "text/plain" },
    { name: "b.txt", type: "text/plain" },
    { name: "c.txt", type: "text/plain" },
  ];
  const result = addPendingAttachments(existing, incoming);
  assert.equal(result.pending.length, 10);
  assert.equal(result.rejected, 1);
  assert.match(result.rejectedReason, /at most 10 files per message/);
  assert.match(result.rejectedReason, /That file was not added/);
});

test("addPendingAttachments rejects everything when already at the cap", () => {
  const existing = Array.from({ length: 10 }, (_, i) => ({ id: `seed-${i}`, file: { name: `seed${i}` }, previewUrl: "", status: "ready" }));
  const result = addPendingAttachments(existing, [{ name: "x.txt", type: "text/plain" }]);
  assert.equal(result.pending, existing, "must not mutate when cap is hit");
  assert.equal(result.rejected, 1);
  assert.match(result.rejectedReason, /That file was not added/);
});

test("addPendingAttachments accepts multiple files at the boundary", () => {
  const existing = Array.from({ length: 9 }, (_, i) => ({ id: `seed-${i}`, file: { name: `seed${i}` }, previewUrl: "", status: "ready" }));
  const incoming = [{ name: "only.txt", type: "text/plain" }];
  const result = addPendingAttachments(existing, incoming);
  assert.equal(result.pending.length, 10);
  assert.equal(result.rejected, 0);
});

test("addPendingAttachments handles empty input as a no-op", () => {
  const result = addPendingAttachments([], []);
  assert.deepEqual(result, { pending: [], rejected: 0 });
});

// P0 review finding: ChatInput.processFiles previously called
// addPendingAttachments([], files) and then concatenated onto prev, so two
// batches of 6 produced 12 chips. The fix moves the cap into the state
// updater; this test pins the contract the updater relies on.
test("per-message cap survives across sequential addPendingAttachments calls (ChatInput regression)", () => {
  const batch1 = Array.from({ length: 6 }, (_, i) => ({
    name: `f${i}.txt`,
    type: "text/plain",
  }));
  const batch2 = Array.from({ length: 6 }, (_, i) => ({
    name: `g${i}.txt`,
    type: "text/plain",
  }));

  const result1 = addPendingAttachments([], batch1);
  assert.equal(result1.pending.length, 6);
  assert.equal(result1.rejected, 0);

  // The fix calls addPendingAttachments against the running prev, so the
  // second batch sees prev.length === 6 and rejects 2 of 6.
  const result2 = addPendingAttachments(result1.pending, batch2);
  assert.equal(result2.pending.length, 10);
  assert.equal(result2.rejected, 2);
  assert.match(result2.rejectedReason, /at most 10 files per message/);
  assert.match(result2.rejectedReason, /2 extra files were not added/);
});

test("addPendingAttachments caps a second batch that overflows by exactly one", () => {
  // 9 + 2 = 11: one rejected with the singular "That file was not added" message.
  const existing = Array.from({ length: 9 }, (_, i) => ({
    id: `seed-${i}`,
    file: { name: `seed${i}` },
    previewUrl: "",
    status: "ready",
  }));
  const incoming = [
    { name: "ok.txt", type: "text/plain" },
    { name: "tail.txt", type: "text/plain" },
  ];
  const result = addPendingAttachments(existing, incoming);
  assert.equal(result.pending.length, 10);
  assert.equal(result.rejected, 1);
  assert.match(result.rejectedReason, /That file was not added/);
});

test("addPendingAttachments preserves duplicate original names as separate chips", () => {
  const incoming = [
    { name: "report.pdf", type: "application/pdf" },
    { name: "report.pdf", type: "application/pdf" },
  ];
  const result = addPendingAttachments([], incoming);
  assert.equal(result.pending.length, 2);
  assert.notEqual(result.pending[0].id, result.pending[1].id);
  assert.equal(result.pending[0].file.name, "report.pdf");
  assert.equal(result.pending[1].file.name, "report.pdf");
});

test("removePendingAttachment removes by id without mutating the input", () => {
  const list = [
    { id: "a", file: { name: "a" }, previewUrl: "", status: "ready" },
    { id: "b", file: { name: "b" }, previewUrl: "", status: "ready" },
    { id: "c", file: { name: "c" }, previewUrl: "", status: "ready" },
  ];
  const next = removePendingAttachment(list, "b");
  assert.equal(next.length, 2);
  assert.equal(next[0].id, "a");
  assert.equal(next[1].id, "c");
  assert.equal(list.length, 3, "original list must remain untouched");
});

test("removePendingAttachment returns the same list when the id is unknown", () => {
  const list = [{ id: "a", file: {}, previewUrl: "", status: "ready" }];
  const next = removePendingAttachment(list, "missing");
  assert.equal(next.length, 1);
  assert.equal(next[0].id, "a");
});

test("clearPendingAttachments revokes every previewUrl and returns []", () => {
  const calls = [];
  const originalRevoke = globalThis.URL?.revokeObjectURL;
  globalThis.URL.revokeObjectURL = (url) => calls.push(url);
  const list = [
    { id: "a", file: {}, previewUrl: "blob:1", status: "ready" },
    { id: "b", file: {}, previewUrl: "", status: "ready" },
    { id: "c", file: {}, previewUrl: "blob:2", status: "ready" },
  ];
  const cleared = clearPendingAttachments(list);
  assert.deepEqual(cleared, []);
  assert.deepEqual(calls, ["blob:1", "blob:2"]);
  if (originalRevoke) globalThis.URL.revokeObjectURL = originalRevoke; else delete globalThis.URL.revokeObjectURL;
});