import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { uploadAttachments } = await jiti.import("./attachment-upload.ts");

/**
 * Stub `globalThis.fetch` for the duration of the test. Returns the
 * restore function so the test can wire it into `t.after`.
 */
function withFetch(handler, t) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  if (t && typeof t.after === "function") {
    t.after(() => {
      globalThis.fetch = originalFetch;
    });
  }
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function file(name, type, bytes = [0x61]) {
  return new File([new Uint8Array(bytes)], name, { type });
}

test("uploadAttachments posts cwd, sessionId, and the files to /api/file-upload", async (t) => {
  const captured = { url: null, method: null, body: null };
  await withFetch(async (url, init) => {
    captured.url = url;
    captured.method = init.method;
    // FormData isn't introspectable from the test side except via entries.
    const form = init.body;
    captured.body = {
      cwd: form.get("cwd"),
      sessionId: form.get("sessionId"),
      fileCount: form.getAll("file").length,
      firstFileName: form.getAll("file")[0]?.name,
    };
    return new Response(
      JSON.stringify({
        files: [
          {
            name: "doc.pdf",
            path: ".pi-uploads/sess/aaaaaaaaaaaaaaaa.pdf",
            mimeType: "application/pdf",
            size: 1,
            data: null,
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }, t);

  const result = await uploadAttachments("/tmp/proj", "sess", [file("doc.pdf", "application/pdf")]);
  assert.equal(result.ok, true);
  assert.equal(captured.url, "/api/file-upload");
  assert.equal(captured.method, "POST");
  assert.equal(captured.body.cwd, "/tmp/proj");
  assert.equal(captured.body.sessionId, "sess");
  assert.equal(captured.body.fileCount, 1);
  assert.equal(captured.body.firstFileName, "doc.pdf");
  assert.equal(result.files[0].name, "doc.pdf");
  assert.equal(result.files[0].data, null);
});

test("uploadAttachments resolves with the server-provided error message on 4xx", async (t) => {
  await withFetch(async () => {
    return new Response(
      JSON.stringify({ error: "File names must not contain a path: ../etc" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }, t);

  const result = await uploadAttachments(
    "/tmp/proj",
    "sess",
    [file("../etc/passwd", "text/plain")],
  );
  assert.deepEqual(result, {
    ok: false,
    error: "File names must not contain a path: ../etc",
  });
});

test("uploadAttachments falls back to 'HTTP <status>' when the 4xx body has no error field", async (t) => {
  await withFetch(async () => {
    return new Response("not-json-or-empty", { status: 403 });
  }, t);

  const result = await uploadAttachments("/tmp/proj", "sess", [file("doc.pdf", "application/pdf")]);
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 403/);
});

test("uploadAttachments turns network failures into a tagged ok:false result", async (t) => {
  await withFetch(async () => {
    throw new TypeError("Failed to fetch");
  }, t);

  const result = await uploadAttachments("/tmp/proj", "sess", [file("a.txt", "text/plain")]);
  assert.equal(result.ok, false);
  assert.match(result.error, /Upload failed: /);
  assert.match(result.error, /Failed to fetch/);
});

test("uploadAttachments refuses to call the route with empty inputs", async () => {
  const result = await uploadAttachments("/tmp/proj", "sess", []);
  assert.deepEqual(result, { ok: false, error: "No attachments to upload" });
  const noCwd = await uploadAttachments("", "sess", [file("a.txt", "text/plain")]);
  assert.equal(noCwd.ok, false);
  assert.match(noCwd.error, /project path/i);
  const noSid = await uploadAttachments("/tmp/proj", "", [file("a.txt", "text/plain")]);
  assert.equal(noSid.ok, false);
  assert.match(noSid.error, /session/i);
});

test("uploadAttachments detects partial responses (records.count !== files.length)", async (t) => {
  await withFetch(async () => {
    return new Response(
      JSON.stringify({ files: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }, t);

  const result = await uploadAttachments("/tmp/proj", "sess", [file("a.txt", "text/plain")]);
  assert.equal(result.ok, false);
  assert.match(result.error, /0 of 1/);
});

test("uploadAttachments tolerates missing `data` on non-image records", async (t) => {
  await withFetch(async () => {
    return new Response(
      JSON.stringify({
        files: [
          {
            name: "doc.pdf",
            path: ".pi-uploads/sess/aaaaaaaaaaaaaaaa.pdf",
            mimeType: "application/pdf",
            size: 12,
            // no `data` key at all — should default to null
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }, t);

  const result = await uploadAttachments("/tmp/proj", "sess", [file("doc.pdf", "application/pdf")]);
  assert.equal(result.ok, true);
  assert.equal(result.files[0].data, null);
});
