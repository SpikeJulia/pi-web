import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");

function resetAllowedRoots() {
  globalThis.__piAdditionalAllowedRoots = new Set();
  globalThis.__piAllowedRootsCache = {
    roots: new Set(),
    expiresAt: Date.now() + 60_000,
  };
}

function createProject(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-studio-attachments-cleanup-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function makeCleanupRequest(body) {
  return new Request("http://localhost/api/attachments/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(response) {
  return await response.json();
}

function seedSessionUploads(cwd, sessionId, fileNames) {
  const dir = join(cwd, ".pi-uploads", sessionId);
  mkdirSync(dir, { recursive: true });
  for (const fileName of fileNames) {
    writeFileSync(join(dir, fileName), "x", "utf8");
    writeFileSync(join(dir, `${fileName}.meta.json`), "{}", "utf8");
  }
}

// --- validation: missing or malformed fields ---

test("POST rejects a missing cwd with 400", async () => {
  const response = await POST(makeCleanupRequest({ scope: "project" }));
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /cwd/);
});

test("POST rejects a relative cwd with 400", async () => {
  const response = await POST(makeCleanupRequest({ cwd: "relative/path", scope: "project" }));
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /absolute/);
});

test("POST rejects a missing scope with 400", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const response = await POST(makeCleanupRequest({ cwd }));
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /scope/);
});

test("POST rejects an unknown scope with 400", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const response = await POST(makeCleanupRequest({ cwd, scope: "weird" }));
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /scope/);
});

test("POST rejects a session-scope request without a sessionId with 400", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const response = await POST(makeCleanupRequest({ cwd, scope: "session" }));
  assert.equal(response.status, 400);
  const body = await readJson(response);
  assert.match(body.error, /sessionId/);
});

test("POST rejects a sessionId containing path segments with 400", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  for (const bad of [
    "../escape",
    "..",
    ".",
    "folder/inner",
    "folder\\inner",
    "evil\0id",
    "",
  ]) {
    const response = await POST(makeCleanupRequest({
      cwd,
      scope: "session",
      sessionId: bad,
    }));
    assert.equal(response.status, 400, `expected reject for sessionId=${JSON.stringify(bad)}`);
    const body = await readJson(response);
    assert.match(body.error, /sessionId/);
  }
  // Nothing was created or deleted under the upload directory.
  assert.equal(existsSync(join(cwd, ".pi-uploads")), false);
});

// --- authorization ---

test("POST returns 403 when cwd is not in the allowed roots set", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  const response = await POST(makeCleanupRequest({ cwd, scope: "project" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await readJson(response), { error: "Access denied" });
});

// --- session scope ---

test("POST session scope deletes the session directory and returns its path", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const sessionId = "sess-cleanup-1";
  seedSessionUploads(cwd, sessionId, ["a1b2c3d4e5f6g7h8.pdf", "deadbeefcafebab0.txt"]);

  const sessionDir = join(cwd, ".pi-uploads", sessionId);
  assert.equal(existsSync(sessionDir), true);

  const response = await POST(makeCleanupRequest({
    cwd,
    scope: "session",
    sessionId,
  }));
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.scope, "session");
  assert.equal(body.sessionId, sessionId);
  assert.equal(body.path, `.pi-uploads/${sessionId}`);
  assert.equal(body.deletedCount, 4); // 2 files + 2 sidecars
  assert.equal(existsSync(sessionDir), false);

  // Sibling session directories are not touched.
  const otherSession = "sess-cleanup-1-keep";
  seedSessionUploads(cwd, otherSession, ["keep1.bin"]);
  assert.equal(existsSync(join(cwd, ".pi-uploads", otherSession)), true);
});

test("POST session scope removes only the targeted session when multiple are present", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  seedSessionUploads(cwd, "alpha", ["a.txt"]);
  seedSessionUploads(cwd, "beta", ["b.txt", "c.txt"]);

  const response = await POST(makeCleanupRequest({
    cwd,
    scope: "session",
    sessionId: "alpha",
  }));
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.deletedCount, 2); // 1 file + 1 sidecar

  assert.equal(existsSync(join(cwd, ".pi-uploads", "alpha")), false);
  assert.equal(existsSync(join(cwd, ".pi-uploads", "beta")), true);
  // beta still has its expected entries.
  const betaLeft = readdirSync(join(cwd, ".pi-uploads", "beta"));
  assert.equal(betaLeft.length, 4);
});

test("POST session scope is a no-op when the session directory is missing", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  // .pi-uploads might not exist at all.
  const response = await POST(makeCleanupRequest({
    cwd,
    scope: "session",
    sessionId: "never-existed",
  }));
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.scope, "session");
  assert.equal(body.sessionId, "never-existed");
  assert.equal(body.deletedCount, 0);
  assert.equal(body.path, ".pi-uploads/never-existed");
});

test("POST session scope works when .pi-uploads exists but the session dir does not", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  // Create the parent but not the session dir.
  mkdirSync(join(cwd, ".pi-uploads", "other-session"), { recursive: true });
  writeFileSync(join(cwd, ".pi-uploads", "other-session", "kept.bin"), "x", "utf8");

  const response = await POST(makeCleanupRequest({
    cwd,
    scope: "session",
    sessionId: "ghost",
  }));
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.deletedCount, 0);
  // The other session survives.
  assert.equal(existsSync(join(cwd, ".pi-uploads", "other-session", "kept.bin")), true);
});

// --- project scope ---

test("POST project scope deletes the entire .pi-uploads directory and returns the path", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  seedSessionUploads(cwd, "sess-A", ["a.pdf", "b.txt"]);
  seedSessionUploads(cwd, "sess-B", ["c.pdf"]);
  // A stray file directly under .pi-uploads is also removed.
  writeFileSync(join(cwd, ".pi-uploads", "stray.txt"), "oops", "utf8");

  const response = await POST(makeCleanupRequest({ cwd, scope: "project" }));
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.scope, "project");
  assert.equal(body.path, ".pi-uploads");
  // Entries under .pi-uploads: stray.txt (1), sess-A/ (1) holding 4 entries,
  // sess-B/ (1) holding 2 entries = 9 in total.
  assert.equal(body.deletedCount, 9);
  assert.equal(existsSync(join(cwd, ".pi-uploads")), false);
});

test("POST project scope is a no-op when .pi-uploads is missing", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  const response = await POST(makeCleanupRequest({ cwd, scope: "project" }));
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.scope, "project");
  assert.equal(body.path, ".pi-uploads");
  assert.equal(body.deletedCount, 0);
  assert.equal(existsSync(join(cwd, ".pi-uploads")), false);
});

test("POST project scope does not touch other directories like .pi", async (t) => {
  resetAllowedRoots();
  const cwd = createProject(t);
  allowFileRoot(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), "{}", "utf8");
  seedSessionUploads(cwd, "sess", ["x.pdf"]);

  const response = await POST(makeCleanupRequest({ cwd, scope: "project" }));
  assert.equal(response.status, 200);
  assert.equal(existsSync(join(cwd, ".pi-uploads")), false);
  // .pi and its file are preserved.
  assert.equal(existsSync(join(cwd, ".pi", "settings.json")), true);
});

// --- isolation: two projects do not share cleanup ---

test("POST does not delete another project's .pi-uploads directory", async (t) => {
  resetAllowedRoots();
  const projectA = createProject(t);
  const projectB = createProject(t);
  allowFileRoot(projectA);
  allowFileRoot(projectB);
  seedSessionUploads(projectA, "sess", ["a.pdf"]);
  seedSessionUploads(projectB, "sess", ["b.pdf"]);

  const response = await POST(
    makeCleanupRequest({ cwd: projectA, scope: "project" }),
  );
  assert.equal(response.status, 200);

  assert.equal(existsSync(join(projectA, ".pi-uploads")), false);
  assert.equal(existsSync(join(projectB, ".pi-uploads", "sess")), true);
  assert.equal(
    existsSync(join(projectB, ".pi-uploads", "sess", "b.pdf")),
    true,
  );
});
