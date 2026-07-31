import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST, __rollbackWrittenFiles } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");

function resetAllowedRoots() {
  globalThis.__piAdditionalAllowedRoots = new Set();
  globalThis.__piAllowedRootsCache = {
    roots: new Set(),
    expiresAt: Date.now() + 60_000,
  };
}

function createProject(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-file-upload-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

async function readJson(response) {
  return await response.json();
}

function makeUploadRequest({ cwd, sessionId, files }) {
  const form = new FormData();
  form.append("cwd", cwd ?? "");
  form.append("sessionId", sessionId ?? "");
  for (const file of files) form.append("file", file);
  return new Request("http://localhost/api/file-upload", {
    method: "POST",
    body: form,
  });
}

function makeFile(name, type, bytes) {
  return new File([new Uint8Array(bytes)], name, { type });
}

// --- size limits ---

test("POST rejects an image above 10MB with 413 and does not write to disk", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-big-img";
  const tenMb = 10 * 1024 * 1024;
  const oversized = new Uint8Array(tenMb + 1);

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("huge.png", "image/png", oversized)],
    }),
  );
  assert.equal(response.status, 413);
  const body = await readJson(response);
  assert.match(body.error, /10MB/);
  assert.match(body.error, /huge\.png/);
  // Nothing was persisted under .pi-uploads/<sessionId>/.
  assert.equal(existsSync(join(cwd, ".pi-uploads", sessionId)), false);
});

test("POST accepts an image at exactly 10MB", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-edge-img";
  const tenMb = 10 * 1024 * 1024;

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("edge.png", "image/png", new Uint8Array(tenMb))],
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(existsSync(join(cwd, ".pi-uploads", sessionId)), true);
});

test("POST rejects a path-channel file above 50MB with 413", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-big-pdf";
  const fiftyMb = 50 * 1024 * 1024;
  const oversized = new Uint8Array(fiftyMb + 1);

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("huge.pdf", "application/pdf", oversized)],
    }),
  );
  assert.equal(response.status, 413);
  const body = await readJson(response);
  assert.match(body.error, /50MB/);
  assert.match(body.error, /huge\.pdf/);
  assert.equal(existsSync(join(cwd, ".pi-uploads", sessionId)), false);
});

test("POST accepts a path-channel file at exactly 50MB", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-edge-pdf";
  const fiftyMb = 50 * 1024 * 1024;

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("edge.pdf", "application/pdf", new Uint8Array(fiftyMb))],
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(existsSync(join(cwd, ".pi-uploads", sessionId)), true);
});

// --- executable rejection ---

test("POST rejects every executable extension with 400", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  for (const ext of ["exe", "bat", "cmd", "ps1", "dll", "so"]) {
    const sessionId = `sess-${ext}`;
    const response = await POST(
      makeUploadRequest({
        cwd,
        sessionId,
        files: [makeFile(`evil.${ext}`, "application/octet-stream", [0x00])],
      }),
    );
    assert.equal(response.status, 400, `expected ${ext} to be rejected`);
    const body = await readJson(response);
    assert.match(body.error, new RegExp(`\\.${ext}`));
    assert.equal(existsSync(join(cwd, ".pi-uploads", sessionId)), false);
  }
});

test("POST rejects a multi-file request whose second file is an executable", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-mixed-exe";
  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [
        makeFile("ok.pdf", "application/pdf", [0x25]),
        makeFile("evil.exe", "application/octet-stream", [0x4d, 0x5a]),
      ],
    }),
  );
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /\.exe/);
  // No files were persisted because preflight rejected the whole batch.
  assert.equal(existsSync(join(cwd, ".pi-uploads", sessionId)), false);
});

// --- unknown-but-harmless extensions land in the path channel ---

test("POST accepts unknown extensions through the path channel with null data", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-unknown";

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [
        makeFile("data.foo", "application/octet-stream", [0x01]),
        makeFile("archive.unitypackage", "application/octet-stream", [0x02]),
      ],
    }),
  );
  assert.equal(response.status, 200);
  const body = await readJson(response);
  for (const record of body.files) {
    assert.equal(record.data, null, `${record.name} should not be base64-encoded`);
    assert.match(record.path, /\.foo$|\.unitypackage$/);
  }
});

test("POST accepts the path-channel allowlist as path-channel files", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-allowlist";
  const files = [
    makeFile("doc.pdf", "application/pdf", [0x25]),
    makeFile("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", [0x50]),
    makeFile("sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", [0x50]),
    makeFile("deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", [0x50]),
    makeFile("data.csv", "text/csv", [0x61]),
    makeFile("notes.txt", "text/plain", [0x68]),
    makeFile("README.md", "text/markdown", [0x23]),
    makeFile("a.zip", "application/zip", [0x50]),
    makeFile("a.tar", "application/x-tar", [0x61]),
    makeFile("a.gz", "application/gzip", [0x1f]),
    makeFile("a.7z", "application/x-7z-compressed", [0x37]),
    makeFile("song.mp3", "audio/mpeg", [0xff]),
    makeFile("song.wav", "audio/wav", [0x52]),
    makeFile("song.ogg", "audio/ogg", [0x4f]),
    makeFile("song.m4a", "audio/mp4", [0x00]),
    makeFile("song.flac", "audio/flac", [0x66]),
    makeFile("clip.mp4", "video/mp4", [0x00]),
    makeFile("clip.webm", "video/webm", [0x1a]),
    makeFile("clip.mov", "video/quicktime", [0x00]),
  ];

  const response = await POST(makeUploadRequest({ cwd, sessionId, files }));
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.files.length, files.length);
  // None of these are image/* so `data` must be null across the board.
  for (const record of body.files) assert.equal(record.data, null);
});

test("POST leaves a path-channel file's data field as null regardless of its bytes", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-pdf-data";
  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("contract.pdf", "application/pdf", [0x25, 0x50, 0x44, 0x46])],
    }),
  );
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.files[0].data, null);
});

// --- transactional cleanup on partial multi-file failure ---

test("POST aborts the whole batch when one file is oversized (no orphan files)", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-partial-big";
  const tenMb = 10 * 1024 * 1024;

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [
        makeFile("ok.png", "image/png", [0x89, 0x50]),
        makeFile("huge.png", "image/png", new Uint8Array(tenMb + 1)),
      ],
    }),
  );
  assert.equal(response.status, 413);
  assert.equal(existsSync(join(cwd, ".pi-uploads", sessionId)), false);
});

test("POST writes nothing when the preflight rejection is a name error", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-partial-name";
  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [
        makeFile("ok.pdf", "application/pdf", [0x25]),
        makeFile("folder/secret.txt", "text/plain", [0x68]),
      ],
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(existsSync(join(cwd, ".pi-uploads", sessionId)), false);
});

test("POST responds 500 and writes nothing when the upload directory is read-only", async (t) => {
  // Writable at first (so the route can mkdirSync), but chmod'd to read-only
  // before the request so any writeFileSync inside persistUpload fails with
  // EACCES. The route's catch block is exercised, the response is 500, and
  // no files are left behind because nothing ever persisted.
  //
  // Note: this test only verifies the "failure-before-any-write" branch.
  // The "write-one-then-fail" branch is covered separately by the
  // __rollbackWrittenFiles unit tests below; ESM modules are sealed so we
  // cannot monkey-patch writeFileSync to deterministically reproduce a
  // mid-batch failure here.
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-readonly";
  const uploadDir = join(cwd, ".pi-uploads", sessionId);
  mkdirSync(uploadDir, { recursive: true });
  chmodSync(uploadDir, 0o555);
  t.after(() => {
    try {
      chmodSync(uploadDir, 0o755);
    } catch {
      // ignore — best-effort restore so the rmSync cleanup can run
    }
  });

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("ok.pdf", "application/pdf", [0x25, 0x50, 0x44, 0x46])],
    }),
  );
  assert.equal(response.status, 500);
  const body = await readJson(response);
  assert.ok(body.error);
  assert.equal(existsSync(uploadDir), true, "the directory itself should still exist");
  // No file or sidecar was created.
  assert.equal(readdirSync(uploadDir).length, 0);
});

// --- rollback helper unit tests ---

test("__rollbackWrittenFiles removes every stored file and its sidecar", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-rollback-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const storedPath = join(dir, "aabbccdd.bin");
  const sidecarPath = `${storedPath}.meta.json`;
  writeFileSync(storedPath, "binary", "utf8");
  writeFileSync(sidecarPath, "{}", "utf8");

  __rollbackWrittenFiles([{ storedPath, sidecarPath }]);
  assert.equal(existsSync(storedPath), false);
  assert.equal(existsSync(sidecarPath), false);
});

test("__rollbackWrittenFiles tolerates a missing sidecar", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-rollback-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const storedPath = join(dir, "aabbccdd.bin");
  const sidecarPath = `${storedPath}.meta.json`;
  writeFileSync(storedPath, "binary", "utf8");

  __rollbackWrittenFiles([{ storedPath, sidecarPath }]);
  assert.equal(existsSync(storedPath), false);
  assert.equal(existsSync(sidecarPath), false);
});

test("__rollbackWrittenFiles swallows per-path errors and keeps going", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-rollback-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const keptPath = join(dir, "kept.bin");
  const keptSidecar = `${keptPath}.meta.json`;
  writeFileSync(keptPath, "kept", "utf8");
  writeFileSync(keptSidecar, "kept-meta", "utf8");

  // One entry references nonexistent paths; another references a real one.
  // The helper must delete the real one without raising.
  __rollbackWrittenFiles([
    { storedPath: join(dir, "missing.bin"), sidecarPath: join(dir, "missing.bin.meta.json") },
    { storedPath: keptPath, sidecarPath: keptSidecar },
  ]);
  assert.equal(existsSync(keptPath), false);
  assert.equal(existsSync(keptSidecar), false);
});

// --- .gitignore injection ---

test("POST creates <cwd>/.gitignore with .pi-uploads/ when none exists", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-gin-1";

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("ok.pdf", "application/pdf", [0x25])],
    }),
  );
  assert.equal(response.status, 200);
  const gitignorePath = join(cwd, ".gitignore");
  assert.equal(existsSync(gitignorePath), true);
  assert.match(readFileSync(gitignorePath, "utf8"), /\.pi-uploads\//);
});

test("POST appends .pi-uploads/ to an existing .gitignore without rewriting it", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-gin-2";
  const gitignorePath = join(cwd, ".gitignore");
  const original = "node_modules/\n.DS_Store\n";
  writeFileSync(gitignorePath, original, "utf8");

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("ok.pdf", "application/pdf", [0x25])],
    }),
  );
  assert.equal(response.status, 200);
  const next = readFileSync(gitignorePath, "utf8");
  assert.match(next, /node_modules\//);
  assert.match(next, /\.DS_Store/);
  assert.match(next, /\.pi-uploads\//);
  // Existing rules remain at line starts.
  assert.match(next, /^node_modules\/$/m);
});

test("POST does not touch .gitignore when the rule already exists", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-gin-3";
  const gitignorePath = join(cwd, ".gitignore");
  const original = "node_modules/\n.pi-uploads/\n";
  writeFileSync(gitignorePath, original, "utf8");

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("ok.pdf", "application/pdf", [0x25])],
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(readFileSync(gitignorePath, "utf8"), original);
});

test("POST does not inject .gitignore when the upload fails preflight", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-gin-4";

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("evil.exe", "application/octet-stream", [0x4d])],
    }),
  );
  assert.equal(response.status, 400);
  // The gitignore hint is part of the success path only.
  assert.equal(existsSync(join(cwd, ".gitignore")), false);
});

test("POST respects missing trailing newline when appending the rule", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-gin-5";
  const gitignorePath = join(cwd, ".gitignore");
  // No trailing newline.
  writeFileSync(gitignorePath, "node_modules/", "utf8");

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("ok.pdf", "application/pdf", [0x25])],
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(readFileSync(gitignorePath, "utf8"), "node_modules/\n.pi-uploads/\n");
});

test("POST appends the rule to a multi-file batch after all files succeed", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-gin-6";
  const gitignorePath = join(cwd, ".gitignore");
  writeFileSync(gitignorePath, "node_modules/\n", "utf8");

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [
        makeFile("ok.png", "image/png", [0x89, 0x50]),
        makeFile("ok.pdf", "application/pdf", [0x25]),
      ],
    }),
  );
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.files.length, 2);
  assert.match(readFileSync(gitignorePath, "utf8"), /\.pi-uploads\/$/m);
});
