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

test("isImageFile matches any image/* MIME", () => {
  assert.equal(isImageFile({ type: "image/png" }), true);
  assert.equal(isImageFile({ type: "image/jpeg" }), true);
  assert.equal(isImageFile({ type: "image/svg+xml" }), true);
  assert.equal(isImageFile({ type: "application/pdf" }), false);
  assert.equal(isImageFile({ type: "text/plain" }), false);
  // Files dragged from some file managers have no MIME type; treat as
  // non-image so the path-channel code path handles them.
  assert.equal(isImageFile({ type: "" }), false);
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