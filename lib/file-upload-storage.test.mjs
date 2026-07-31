import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./file-upload-storage.ts");
}

test("validateAttachmentFileName accepts simple names with or without extensions", async () => {
  const { validateAttachmentFileName } = await loadSubject();
  for (const name of [
    "contract.pdf",
    "my file with spaces.txt",
    "image.PNG",
    "no-extension",
    "dotted.name.tar.gz",
    "中文报告.pdf",
  ]) {
    assert.equal(validateAttachmentFileName(name), null, `expected ${name} to be valid`);
  }
});

test("validateAttachmentFileName rejects empty, dot, and dotdot names", async () => {
  const { validateAttachmentFileName } = await loadSubject();
  for (const name of ["", ".", ".."]) {
    const error = validateAttachmentFileName(name);
    assert.ok(error, `expected ${JSON.stringify(name)} to be rejected`);
    assert.match(error, /Invalid file name/);
  }
});

test("validateAttachmentFileName rejects names with path separators", async () => {
  const { validateAttachmentFileName } = await loadSubject();
  for (const name of [
    "folder/file.txt",
    "../secret.txt",
    "folder\\secret.txt",
    "a\\b\\c.pdf",
    "a/b/c.png",
  ]) {
    const error = validateAttachmentFileName(name);
    assert.ok(error, `expected ${JSON.stringify(name)} to be rejected`);
    assert.match(error, /must not contain a path/);
  }
});

test("validateAttachmentFileName rejects names containing NUL", async () => {
  const { validateAttachmentFileName } = await loadSubject();
  const error = validateAttachmentFileName("evil\u0000.txt");
  assert.ok(error);
  assert.match(error, /Invalid file name/);
});

test("generateStoredFileName is 16 hex chars plus a lowercased extension", async () => {
  const { generateStoredFileName } = await loadSubject();
  assert.match(generateStoredFileName("contract.pdf"), /^[0-9a-f]{16}\.pdf$/);
  assert.match(generateStoredFileName("REPORT.PDF"), /^[0-9a-f]{16}\.pdf$/);
  // Tarballs keep only the last extension, matching getFileExt behavior.
  assert.match(generateStoredFileName("archive.tar.gz"), /^[0-9a-f]{16}\.gz$/);
});

test("generateStoredFileName omits the dot when the input has no extension", async () => {
  const { generateStoredFileName } = await loadSubject();
  assert.match(generateStoredFileName("README"), /^[0-9a-f]{16}$/);
  // Node's path.extname treats leading-dot files like .env as having no
  // extension, which is fine: the original name is recovered from the sidecar.
  assert.match(generateStoredFileName(".env"), /^[0-9a-f]{16}$/);
});

test("generateStoredFileName produces a different name every call", async () => {
  const { generateStoredFileName } = await loadSubject();
  const seen = new Set();
  for (let i = 0; i < 32; i += 1) {
    seen.add(generateStoredFileName("file.txt"));
  }
  assert.equal(seen.size, 32, "expected every call to produce a unique random name");
});

test("getRelativeUploadPath returns a posix path under .pi-uploads/<sessionId>/", async () => {
  const { getRelativeUploadPath } = await loadSubject();
  assert.equal(
    getRelativeUploadPath("sess-1", "aabbccddeeff0011.pdf"),
    ".pi-uploads/sess-1/aabbccddeeff0011.pdf",
  );
});

test("getUploadDirectory composes <cwd>/.pi-uploads/<sessionId>", async () => {
  const { getUploadDirectory } = await loadSubject();
  const cwd = path.join("some", "project", "root");
  assert.equal(
    getUploadDirectory(cwd, "sess-1"),
    path.join(cwd, ".pi-uploads", "sess-1"),
  );
});

test("isImageMimeType returns true only for image/* MIME types", async () => {
  const { isImageMimeType } = await loadSubject();
  for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]) {
    assert.equal(isImageMimeType(type), true, `expected ${type} to be an image`);
  }
  for (const type of [
    "application/pdf",
    "text/plain",
    "application/json",
    "",
    "video/mp4",
    "audio/mpeg",
  ]) {
    assert.equal(isImageMimeType(type), false, `expected ${type} to be a non-image`);
  }
});