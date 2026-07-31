import assert from "node:assert/strict";
import {
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
const { POST } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");

function resetAllowedRoots() {
  globalThis.__piAdditionalAllowedRoots = new Set();
  globalThis.__piAllowedRootsCache = {
    roots: new Set(),
    expiresAt: Date.now() + 60_000,
  };
}

function createProject(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-web-file-upload-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

async function readJson(response) {
  return await response.json();
}

function makeUploadRequest({ cwd, sessionId, files, omitFields = [] }) {
  const form = new FormData();
  if (!omitFields.includes("cwd")) form.append("cwd", cwd ?? "");
  if (!omitFields.includes("sessionId")) form.append("sessionId", sessionId ?? "");
  if (!omitFields.includes("files") && files) {
    for (const file of files) form.append("file", file);
  }
  return new Request("http://localhost/api/file-upload", {
    method: "POST",
    body: form,
  });
}

function makeFile(name, type, bytes) {
  return new File([new Uint8Array(bytes)], name, { type });
}

// --- validation: missing or malformed fields ---

test("POST rejects a missing cwd with 400", async () => {
  const request = makeUploadRequest({
    cwd: "",
    sessionId: "sess-1",
    files: [makeFile("contract.pdf", "application/pdf", [1, 2, 3])],
  });
  const response = await POST(request);
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /cwd/);
});

test("POST rejects a relative cwd with 400", async () => {
  const request = makeUploadRequest({
    cwd: "relative/path",
    sessionId: "sess-1",
    files: [makeFile("contract.pdf", "application/pdf", [1, 2, 3])],
  });
  const response = await POST(request);
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /absolute/);
});

test("POST rejects a missing sessionId with 400", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const request = makeUploadRequest({
    cwd,
    sessionId: "",
    files: [makeFile("contract.pdf", "application/pdf", [1, 2, 3])],
  });
  const response = await POST(request);
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /sessionId/);
});

test("POST rejects a request with no file parts with 400", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const request = makeUploadRequest({
    cwd,
    sessionId: "sess-1",
    files: [],
  });
  const response = await POST(request);
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /file/i);
});

// --- authorization: cwd outside allowed roots ---

test("POST returns 403 when cwd is not in the allowed roots set", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  const request = makeUploadRequest({
    cwd,
    sessionId: "sess-1",
    files: [makeFile("contract.pdf", "application/pdf", [1, 2, 3])],
  });
  const response = await POST(request);
  assert.equal(response.status, 403);
  assert.deepEqual(await readJson(response), { error: "Access denied" });
});

// --- success: file lands at .pi-uploads/<sessionId>/<random-hex><.ext> ---

test("POST persists a single file with random hex name and writes a sidecar", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-1";
  const bytes = [1, 2, 3, 4, 5];
  const request = makeUploadRequest({
    cwd,
    sessionId,
    files: [makeFile("contract.pdf", "application/pdf", bytes)],
  });

  const response = await POST(request);
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.files.length, 1);

  const record = body.files[0];
  assert.equal(record.name, "contract.pdf");
  assert.equal(record.mimeType, "application/pdf");
  assert.equal(record.size, bytes.length);
  assert.equal(record.data, null);
  assert.match(record.path, /^\.pi-uploads\/sess-1\/[0-9a-f]{16}\.pdf$/);

  // The stored file and its sidecar both exist on disk.
  const uploadDir = join(cwd, ".pi-uploads", sessionId);
  assert.equal(existsSync(uploadDir), true);
  const dirEntries = readdirSync(uploadDir);
  assert.equal(dirEntries.length, 2, "expected file + sidecar");
  const storedName = record.path.split("/").pop();
  assert.ok(storedName);
  const storedPath = join(uploadDir, storedName);
  assert.ok(dirEntries.includes(storedName));
  assert.ok(dirEntries.includes(`${storedName}.meta.json`));

  // File bytes round-trip.
  const onDisk = readFileSync(storedPath);
  assert.deepEqual(Array.from(onDisk), bytes);

  // Sidecar records originalName, mimeType, size, uploadedAt (ISO).
  const meta = JSON.parse(readFileSync(`${storedPath}.meta.json`, "utf8"));
  assert.equal(meta.originalName, "contract.pdf");
  assert.equal(meta.mimeType, "application/pdf");
  assert.equal(meta.size, bytes.length);
  assert.match(meta.uploadedAt, /^\d{4}-\d{2}-\d{2}T/);

  // Original name must not appear anywhere on disk under the upload dir.
  assert.equal(
    dirEntries.some((entry) => entry.includes("contract")),
    false,
    "the original filename must never be written to disk",
  );
});

test("POST stores multiple files and returns one record per file", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-2";

  const request = makeUploadRequest({
    cwd,
    sessionId,
    files: [
      makeFile("a.txt", "text/plain", [0x61]),
      makeFile("b.json", "application/json", [0x7b]),
      makeFile("c", "", [0x63]),
    ],
  });
  const response = await POST(request);
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.files.length, 3);

  const byName = new Map(body.files.map((file) => [file.name, file]));
  assert.equal(byName.get("a.txt").mimeType, "text/plain");
  assert.equal(byName.get("a.txt").size, 1);
  assert.match(byName.get("a.txt").path, /\.txt$/);
  assert.equal(byName.get("b.json").mimeType, "application/json");
  assert.match(byName.get("b.json").path, /\.json$/);
  // No-extension file: stored filename is exactly 16 hex chars with no dot.
  const cFile = byName.get("c");
  const cStoredName = cFile.path.split("/").pop();
  assert.match(cStoredName, /^[0-9a-f]{16}$/);
});

test("POST returns base64 image data for image/* files and null otherwise", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-3";
  const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const expectedBase64 = Buffer.from(pngBytes).toString("base64");

  const request = makeUploadRequest({
    cwd,
    sessionId,
    files: [
      makeFile("shot.png", "image/png", pngBytes),
      makeFile("notes.txt", "text/plain", [0x68, 0x69]),
    ],
  });
  const response = await POST(request);
  assert.equal(response.status, 200);
  const body = await readJson(response);

  const png = body.files.find((file) => file.name === "shot.png");
  const txt = body.files.find((file) => file.name === "notes.txt");
  assert.equal(png.data, expectedBase64);
  // Plain text should not include a data URL prefix.
  assert.equal(png.data?.startsWith("data:"), false);
  assert.equal(txt.data, null);
});

test("POST allows duplicate original names in the same request as independent files", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-4";
  const a = [0x61, 0x61];
  const b = [0x62, 0x62, 0x62];

  const request = makeUploadRequest({
    cwd,
    sessionId,
    files: [
      makeFile("dup.txt", "text/plain", a),
      makeFile("dup.txt", "text/plain", b),
    ],
  });
  const response = await POST(request);
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.files.length, 2);

  const storedNames = body.files.map((file) => file.path.split("/").pop()).sort();
  assert.notEqual(storedNames[0], storedNames[1]);
  assert.match(storedNames[0], /^[0-9a-f]{16}\.txt$/);
  assert.match(storedNames[1], /^[0-9a-f]{16}\.txt$/);

  // Both sidecars exist and the bytes round-trip independently.
  const uploadDir = join(cwd, ".pi-uploads", sessionId);
  for (const [index, record] of body.files.entries()) {
    const storedPath = join(uploadDir, record.path.split("/").pop());
    const expected = index === 0 ? a : b;
    assert.deepEqual(Array.from(readFileSync(storedPath)), expected);
    const meta = JSON.parse(readFileSync(`${storedPath}.meta.json`, "utf8"));
    assert.equal(meta.originalName, "dup.txt");
    assert.equal(meta.size, expected.length);
  }
});

test("POST rejects filenames containing path segments with 400", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const request = makeUploadRequest({
    cwd,
    sessionId: "sess-5",
    files: [makeFile("folder/file.txt", "text/plain", [0x68])],
  });
  const response = await POST(request);
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /must not contain a path/);
  // Nothing was written under the upload directory.
  assert.equal(existsSync(join(cwd, ".pi-uploads", "sess-5")), false);
});

// --- isolation between sessions and between projects ---

test("Two sessions in the same cwd do not share their upload directories", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const reqA = makeUploadRequest({
    cwd,
    sessionId: "session-A",
    files: [makeFile("a.txt", "text/plain", [0x41])],
  });
  const reqB = makeUploadRequest({
    cwd,
    sessionId: "session-B",
    files: [makeFile("b.txt", "text/plain", [0x42])],
  });
  const resA = await POST(reqA);
  const resB = await POST(reqB);
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);

  const dirA = join(cwd, ".pi-uploads", "session-A");
  const dirB = join(cwd, ".pi-uploads", "session-B");
  assert.equal(existsSync(dirA), true);
  assert.equal(existsSync(dirB), true);
  assert.equal(readdirSync(dirA).length, 2);
  assert.equal(readdirSync(dirB).length, 2);
  // Neither session's directory contains the other session's file.
  assert.equal(
    readdirSync(dirA).some((entry) => entry.endsWith(".txt")),
    true,
  );
  assert.equal(
    readdirSync(dirB).some((entry) => entry.endsWith(".txt")),
    true,
  );
});

test("Two projects do not share their .pi-uploads directories", async (t) => {
  resetAllowedRoots();
  const projectA = createProject(t);
  const projectB = createProject(t);
  allowFileRoot(projectA);
  allowFileRoot(projectB);

  const response = await POST(
    makeUploadRequest({
      cwd: projectA,
      sessionId: "sess",
      files: [makeFile("a.txt", "text/plain", [0x41])],
    }),
  );
  assert.equal(response.status, 200);

  assert.equal(existsSync(join(projectA, ".pi-uploads", "sess")), true);
  assert.equal(existsSync(join(projectB, ".pi-uploads")), false);
});

// --- pre-existing cwd/.pi should not be touched ---

test("POST does not require a pre-existing .pi directory", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId: "sess-6",
      files: [makeFile("a.txt", "text/plain", [0x61])],
    }),
  );
  assert.equal(response.status, 200);
  // The route creates .pi-uploads/ on demand without writing .pi/.
  assert.equal(existsSync(join(cwd, ".pi-uploads", "sess-6")), true);
  assert.equal(existsSync(join(cwd, ".pi")), false);
});

// --- existing unrelated content under .pi-uploads must be left alone ---

test("POST preserves unrelated sidecar files in the upload directory", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-7";
  // Pre-create the upload dir with a file the server did not write.
  const uploadDir = join(cwd, ".pi-uploads", sessionId);
  mkdirSync(uploadDir, { recursive: true });
  writeFileSync(join(uploadDir, "PRE-EXISTING.txt"), "kept", "utf8");

  const response = await POST(
    makeUploadRequest({
      cwd,
      sessionId,
      files: [makeFile("new.txt", "text/plain", [0x6e])],
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(existsSync(join(uploadDir, "PRE-EXISTING.txt")), true);
  const entries = readdirSync(uploadDir);
  assert.equal(entries.includes("PRE-EXISTING.txt"), true);
});