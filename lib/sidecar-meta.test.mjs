import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  fetchSidecarMeta,
  parseSidecarPayload,
  SidecarMetaCache,
  getSidecarApiUrl,
  getStoredFileAbsolutePath,
  getFallbackDisplayName,
} = await jiti.import("./sidecar-meta.ts");

const CWD = "/tmp/proj";
const SESSION = "550e8400-e29b-41d4-a716-446655440000";
const STORED = "a1b2c3d4e5f6a7b8.pdf";

const VALID_META = {
  originalName: "contract.pdf",
  mimeType: "application/pdf",
  size: 12345,
  uploadedAt: "2026-01-01T00:00:00.000Z",
};

function okJson(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function errorJson(status, payload = { error: "Not found" }) {
  return {
    ok: false,
    status,
    json: async () => payload,
  };
}

// --- URL composition ---

test("getSidecarApiUrl URL-encodes each path segment and queries type=read", () => {
  const url = getSidecarApiUrl(CWD, SESSION, STORED);
  // Segments are joined with literal "/" — encodeFilePathForApi only
  // escapes the segment itself, not the path separator. This matches the
  // /api/files/[...path] route's expectation that the catch-all splits on
  // "/".
  assert.equal(
    url,
    `/api/files/tmp/proj/.pi-uploads/${SESSION}/${STORED}.meta.json?type=read`,
  );
});

test("getSidecarApiUrl handles Windows paths by normalizing slashes", () => {
  const url = getSidecarApiUrl("C:\\Users\\me\\proj", SESSION, STORED);
  // encodeFilePathForApi replaces backslashes with forward slashes; the
  // colon in the drive letter gets percent-encoded as part of the segment.
  assert.ok(url.startsWith("/api/files/C%3A/Users/me/proj/.pi-uploads/"));
  assert.ok(url.includes(`${STORED}.meta.json`));
});

// --- parseSidecarPayload ---

test("parseSidecarPayload accepts a complete payload", () => {
  const result = parseSidecarPayload(VALID_META);
  assert.deepEqual(result, VALID_META);
});

test("parseSidecarPayload tolerates extra fields", () => {
  const result = parseSidecarPayload({ ...VALID_META, extra: "ignored" });
  assert.deepEqual(result, VALID_META);
});

test("parseSidecarPayload rejects payloads with missing or wrong-typed fields", () => {
  assert.equal(parseSidecarPayload(null), null);
  assert.equal(parseSidecarPayload({}), null);
  assert.equal(parseSidecarPayload({ ...VALID_META, originalName: "" }), null);
  assert.equal(parseSidecarPayload({ ...VALID_META, mimeType: 123 }), null);
  assert.equal(parseSidecarPayload({ ...VALID_META, size: "big" }), null);
  assert.equal(parseSidecarPayload({ ...VALID_META, size: -1 }), null);
  assert.equal(parseSidecarPayload({ ...VALID_META, size: NaN }), null);
  assert.equal(parseSidecarPayload({ ...VALID_META, uploadedAt: undefined }), null);
});

// --- fetchSidecarMeta ---

test("fetchSidecarMeta returns parsed metadata on success", async () => {
  const meta = await fetchSidecarMeta(CWD, SESSION, STORED, async () => okJson(VALID_META));
  assert.deepEqual(meta, VALID_META);
});

test("fetchSidecarMeta returns null when the fetcher reports a non-2xx status", async () => {
  const meta = await fetchSidecarMeta(CWD, SESSION, STORED, async () => errorJson(404));
  assert.equal(meta, null);
});

test("fetchSidecarMeta returns null when the body is not JSON", async () => {
  const meta = await fetchSidecarMeta(CWD, SESSION, STORED, async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new Error("parse error"); },
  }));
  assert.equal(meta, null);
});

test("fetchSidecarMeta returns null when required fields are missing", async () => {
  const meta = await fetchSidecarMeta(CWD, SESSION, STORED, async () => okJson({ error: "no sidecar" }));
  assert.equal(meta, null);
});

test("fetchSidecarMeta rejects empty cwd / sessionId / storedName inputs", async () => {
  assert.equal(await fetchSidecarMeta("", SESSION, STORED, async () => okJson(VALID_META)), null);
  assert.equal(await fetchSidecarMeta(CWD, "", STORED, async () => okJson(VALID_META)), null);
  assert.equal(await fetchSidecarMeta(CWD, SESSION, "", async () => okJson(VALID_META)), null);
});

test("fetchSidecarMeta lets network errors propagate", async () => {
  await assert.rejects(
    fetchSidecarMeta(CWD, SESSION, STORED, async () => { throw new Error("network down"); }),
    /network down/,
  );
});

// --- SidecarMetaCache ---

test("SidecarMetaCache resolves the sidecar once and reuses the promise", async () => {
  let calls = 0;
  const cache = new SidecarMetaCache(async () => {
    calls += 1;
    return okJson(VALID_META);
  });
  const [a, b, c] = await Promise.all([
    cache.resolve(CWD, SESSION, STORED),
    cache.resolve(CWD, SESSION, STORED),
    cache.resolve(CWD, SESSION, STORED),
  ]);
  assert.equal(calls, 1, "fetcher must be called exactly once for identical keys");
  assert.deepEqual(a, VALID_META);
  assert.equal(b, a);
  assert.equal(c, a);
});

test("SidecarMetaCache caches by full (cwd, session, storedName) key", async () => {
  let calls = 0;
  const cache = new SidecarMetaCache(async () => {
    calls += 1;
    return okJson(VALID_META);
  });
  await cache.resolve(CWD, SESSION, STORED);
  await cache.resolve(CWD, "different-session", STORED);
  await cache.resolve("/different/cwd", SESSION, STORED);
  assert.equal(calls, 3, "different keys must each trigger one fetch");
});

test("SidecarMetaCache.resolve swallows fetcher errors and returns null", async () => {
  const cache = new SidecarMetaCache(async () => { throw new Error("boom"); });
  const meta = await cache.resolve(CWD, SESSION, STORED);
  assert.equal(meta, null, "a failing fetch must degrade to null");
});

test("SidecarMetaCache caches the null result so we do not retry endlessly", async () => {
  let calls = 0;
  const cache = new SidecarMetaCache(async () => {
    calls += 1;
    return errorJson(404);
  });
  await cache.resolve(CWD, SESSION, STORED);
  await cache.resolve(CWD, SESSION, STORED);
  assert.equal(calls, 1);
});

test("SidecarMetaCache evicts least-recently-used entries at its cap", async () => {
  let calls = 0;
  const cache = new SidecarMetaCache(async () => {
    calls += 1;
    return okJson(VALID_META);
  }, 2);

  await cache.resolve(CWD, SESSION, "aaaaaaaaaaaaaaaa.pdf");
  await cache.resolve(CWD, SESSION, "bbbbbbbbbbbbbbbb.pdf");
  await cache.resolve(CWD, SESSION, "aaaaaaaaaaaaaaaa.pdf"); // refresh A
  await cache.resolve(CWD, SESSION, "cccccccccccccccc.pdf"); // evict B
  await cache.resolve(CWD, SESSION, "bbbbbbbbbbbbbbbb.pdf");

  assert.equal(calls, 4);
});

test("SidecarMetaCache.invalidate drops a single entry", async () => {
  let calls = 0;
  const cache = new SidecarMetaCache(async () => {
    calls += 1;
    return okJson(VALID_META);
  });
  await cache.resolve(CWD, SESSION, STORED);
  cache.invalidate(CWD, SESSION, STORED);
  await cache.resolve(CWD, SESSION, STORED);
  assert.equal(calls, 2, "invalidate must trigger a fresh fetch");
});

test("SidecarMetaCache.clear drops every entry", async () => {
  let calls = 0;
  const cache = new SidecarMetaCache(async () => {
    calls += 1;
    return okJson(VALID_META);
  });
  await cache.resolve(CWD, SESSION, STORED);
  await cache.resolve(CWD, SESSION, "ffffffffffffffff.pdf");
  cache.clear();
  await cache.resolve(CWD, SESSION, STORED);
  assert.equal(calls, 3);
});

// --- helpers ---

test("getStoredFileAbsolutePath joins cwd + upload dir + stored name", () => {
  assert.equal(getStoredFileAbsolutePath(CWD, SESSION, STORED), `${CWD}/.pi-uploads/${SESSION}/${STORED}`);
});

test("getFallbackDisplayName returns the stored name verbatim", () => {
  assert.equal(getFallbackDisplayName(STORED), STORED);
  assert.equal(getFallbackDisplayName("noext"), "noext");
});