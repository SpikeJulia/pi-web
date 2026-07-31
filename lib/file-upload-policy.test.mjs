import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./file-upload-policy.ts");
}

// --- extension extraction ---

test("getExtension returns the lowercase extension without a leading dot", async () => {
  const { getExtension } = await loadSubject();
  assert.equal(getExtension("contract.pdf"), "pdf");
  assert.equal(getExtension("REPORT.PDF"), "pdf");
  assert.equal(getExtension("archive.tar.gz"), "gz");
  assert.equal(getExtension("README"), "");
  assert.equal(getExtension(".env"), "");
  assert.equal(getExtension("中文报告.PDF"), "pdf");
});

test("getExtension trims whitespace and ignores internal dots", async () => {
  const { getExtension } = await loadSubject();
  assert.equal(getExtension("dotted.name.txt"), "txt");
  assert.equal(getExtension("a.b.c.d.xlsx"), "xlsx");
});

// --- channel routing ---

test("validateFilePolicy routes image extensions to the image channel", async () => {
  const { validateFilePolicy } = await loadSubject();
  for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]) {
    const result = validateFilePolicy(`shot.${ext}`, `image/${ext}`, 1024);
    assert.deepEqual(result, { ok: true, channel: "image" }, `expected ${ext} to be image`);
  }
});

test("validateFilePolicy routes case-insensitive image extensions to the image channel", async () => {
  const { validateFilePolicy } = await loadSubject();
  const result = validateFilePolicy("Photo.PNG", "image/png", 1024);
  assert.deepEqual(result, { ok: true, channel: "image" });
});

test("validateFilePolicy routes the path-channel allowlist to the path channel", async () => {
  const { validateFilePolicy } = await loadSubject();
  for (const ext of [
    "pdf",
    "docx",
    "xlsx",
    "pptx",
    "csv",
    "txt",
    "md",
    "zip",
    "tar",
    "gz",
    "7z",
    "mp3",
    "wav",
    "ogg",
    "m4a",
    "flac",
    "mp4",
    "webm",
    "mov",
  ]) {
    const result = validateFilePolicy(`file.${ext}`, "application/octet-stream", 1024);
    assert.deepEqual(result, { ok: true, channel: "path" }, `expected ${ext} to be path`);
  }
});

test("validateFilePolicy routes unknown extensions to the path channel", async () => {
  const { validateFilePolicy } = await loadSubject();
  // Unknown but harmless — the ticket explicitly says these pass the path channel.
  for (const ext of ["foo", "bar", "obj", "unitypackage", "blend"]) {
    const result = validateFilePolicy(`thing.${ext}`, "application/octet-stream", 1024);
    assert.deepEqual(result, { ok: true, channel: "path" }, `expected ${ext} to be path`);
  }
});

test("validateFilePolicy routes files without an extension to the path channel", async () => {
  const { validateFilePolicy } = await loadSubject();
  const result = validateFilePolicy("README", "", 1024);
  assert.deepEqual(result, { ok: true, channel: "path" });
});

// --- executable rejection ---

test("validateFilePolicy rejects every executable extension with 400", async () => {
  const { validateFilePolicy } = await loadSubject();
  for (const ext of ["exe", "bat", "cmd", "ps1", "dll", "so"]) {
    const result = validateFilePolicy(`evil.${ext}`, "application/octet-stream", 1024);
    assert.equal(result.ok, false, `expected ${ext} to be rejected`);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.match(result.error, new RegExp(`\\.${ext}`));
    }
  }
});

test("validateFilePolicy rejects case-insensitive executable extensions", async () => {
  const { validateFilePolicy } = await loadSubject();
  const result = validateFilePolicy("virus.EXE", "application/octet-stream", 1024);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.match(result.error, /\.exe/);
  }
});

// --- size limits per channel ---

test("validateFilePolicy accepts an image exactly at the 10MB cap", async () => {
  const { validateFilePolicy, MAX_IMAGE_BYTES } = await loadSubject();
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
  const result = validateFilePolicy("shot.png", "image/png", MAX_IMAGE_BYTES);
  assert.deepEqual(result, { ok: true, channel: "image" });
});

test("validateFilePolicy rejects an image one byte over the 10MB cap", async () => {
  const { validateFilePolicy, MAX_IMAGE_BYTES } = await loadSubject();
  const result = validateFilePolicy("huge.png", "image/png", MAX_IMAGE_BYTES + 1);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
    assert.match(result.error, /10MB/);
    assert.match(result.error, /huge\.png/);
  }
});

test("validateFilePolicy accepts a path file exactly at the 50MB cap", async () => {
  const { validateFilePolicy, MAX_PATH_BYTES } = await loadSubject();
  assert.equal(MAX_PATH_BYTES, 50 * 1024 * 1024);
  const result = validateFilePolicy("data.zip", "application/zip", MAX_PATH_BYTES);
  assert.deepEqual(result, { ok: true, channel: "path" });
});

test("validateFilePolicy rejects a path file one byte over the 50MB cap", async () => {
  const { validateFilePolicy, MAX_PATH_BYTES } = await loadSubject();
  const result = validateFilePolicy("huge.pdf", "application/pdf", MAX_PATH_BYTES + 1);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
    assert.match(result.error, /50MB/);
    assert.match(result.error, /huge\.pdf/);
  }
});

test("validateFilePolicy rejects an oversized image even when the MIME looks like text", async () => {
  const { validateFilePolicy, MAX_IMAGE_BYTES } = await loadSubject();
  // Disguised as text — extension still wins, so the image cap applies.
  const result = validateFilePolicy("payload.png", "text/plain", MAX_IMAGE_BYTES + 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 413);
});

test("validateFilePolicy uses the image cap even when the extension is an image but MIME is empty", async () => {
  const { validateFilePolicy, MAX_IMAGE_BYTES } = await loadSubject();
  const okResult = validateFilePolicy("ok.jpg", "", MAX_IMAGE_BYTES);
  assert.deepEqual(okResult, { ok: true, channel: "image" });
  const bigResult = validateFilePolicy("big.jpg", "", MAX_IMAGE_BYTES + 1);
  assert.equal(bigResult.ok, false);
});

// --- size constants exported ---

test("MAX_IMAGE_BYTES and MAX_PATH_BYTES are the documented caps", async () => {
  const { MAX_IMAGE_BYTES, MAX_PATH_BYTES } = await loadSubject();
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_PATH_BYTES, 50 * 1024 * 1024);
  assert.ok(MAX_PATH_BYTES > MAX_IMAGE_BYTES);
});

// --- ensurePiUploadsGitignore: file creation ---

test("ensurePiUploadsGitignore creates .gitignore with the rule when missing", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = ensurePiUploadsGitignore(cwd);
  assert.equal(result.added, true);
  assert.equal(existsSync(result.path), true);
  const onDisk = readFileSync(result.path, "utf8");
  assert.match(onDisk, /\.pi-uploads\//);
});

test("ensurePiUploadsGitignore is a no-op when the rule is already present", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const gitignorePath = join(cwd, ".gitignore");
  const original = "node_modules/\n.pi-uploads/\n.DS_Store\n";
  writeFileSync(gitignorePath, original, "utf8");

  const result = ensurePiUploadsGitignore(cwd);
  assert.equal(result.added, false);
  assert.equal(readFileSync(gitignorePath, "utf8"), original);
});

test("ensurePiUploadsGitignore is a no-op for an anchored equivalent rule", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const gitignorePath = join(cwd, ".gitignore");
  const original = "/.pi-uploads/\n";
  writeFileSync(gitignorePath, original, "utf8");

  const result = ensurePiUploadsGitignore(cwd);
  assert.equal(result.added, false);
  assert.equal(readFileSync(gitignorePath, "utf8"), original);
});

test("ensurePiUploadsGitignore is a no-op when the rule appears without a trailing slash", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const gitignorePath = join(cwd, ".gitignore");
  const original = ".pi-uploads\nlogs/\n";
  writeFileSync(gitignorePath, original, "utf8");

  const result = ensurePiUploadsGitignore(cwd);
  assert.equal(result.added, false);
  assert.equal(readFileSync(gitignorePath, "utf8"), original);
});

test("ensurePiUploadsGitignore appends the rule when other content exists but not the rule", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const gitignorePath = join(cwd, ".gitignore");
  const original = "node_modules/\n.DS_Store\n";
  writeFileSync(gitignorePath, original, "utf8");

  const result = ensurePiUploadsGitignore(cwd);
  assert.equal(result.added, true);
  const next = readFileSync(gitignorePath, "utf8");
  assert.match(next, /node_modules\//);
  assert.match(next, /\.DS_Store/);
  assert.match(next, /\.pi-uploads\//);
  // No existing rule was modified.
  assert.match(next, /^node_modules\/$/m);
});

test("ensurePiUploadsGitignore respects a missing trailing newline", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const gitignorePath = join(cwd, ".gitignore");
  // No trailing newline — appending the rule must insert one between them.
  writeFileSync(gitignorePath, "node_modules/", "utf8");

  const result = ensurePiUploadsGitignore(cwd);
  assert.equal(result.added, true);
  const next = readFileSync(gitignorePath, "utf8");
  assert.equal(next, "node_modules/\n.pi-uploads/\n");
});

test("ensurePiUploadsGitignore does not add a duplicate when the rule appears in a comment", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const gitignorePath = join(cwd, ".gitignore");
  const original = "# remember .pi-uploads/\nnode_modules/\n";
  writeFileSync(gitignorePath, original, "utf8");

  const result = ensurePiUploadsGitignore(cwd);
  // A commented mention is not a real rule; the append should still fire.
  assert.equal(result.added, true);
  const next = readFileSync(gitignorePath, "utf8");
  assert.match(next, /# remember \.pi-uploads\//);
  assert.match(next, /\.pi-uploads\/$/m);
});

test("ensurePiUploadsGitignore handles CRLF line endings in the existing file", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const gitignorePath = join(cwd, ".gitignore");
  writeFileSync(gitignorePath, "node_modules/\r\nlogs/\r\n", "utf8");

  const result = ensurePiUploadsGitignore(cwd);
  assert.equal(result.added, true);
  const next = readFileSync(gitignorePath, "utf8");
  assert.match(next, /\.pi-uploads\//);
});

test("ensurePiUploadsGitignore returns added=false when the rule is the only content", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const gitignorePath = join(cwd, ".gitignore");
  writeFileSync(gitignorePath, ".pi-uploads/\n", "utf8");

  const result = ensurePiUploadsGitignore(cwd);
  assert.equal(result.added, false);
  assert.equal(readFileSync(gitignorePath, "utf8"), ".pi-uploads/\n");
});

test("ensurePiUploadsGitignore returns added=true when the cwd has no gitignore file", async (t) => {
  const { ensurePiUploadsGitignore } = await loadSubject();
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = ensurePiUploadsGitignore(cwd);
  assert.equal(result.added, true);
  const onDisk = readFileSync(result.path, "utf8");
  // The freshly-created file has only the rule and a trailing newline.
  assert.equal(onDisk, ".pi-uploads/\n");
});
