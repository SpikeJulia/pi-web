import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./url-embed.ts");
}

test("x-frame-options DENY forbids embedding", async () => {
  const { xFrameOptionsForbids } = await loadSubject();
  assert.equal(xFrameOptionsForbids("DENY"), true);
  assert.equal(xFrameOptionsForbids("deny"), true);
});

test("x-frame-options SAMEORIGIN forbids cross-origin preview", async () => {
  const { xFrameOptionsForbids } = await loadSubject();
  assert.equal(xFrameOptionsForbids("SAMEORIGIN"), true);
  assert.equal(xFrameOptionsForbids("sameorigin"), true);
});

test("missing or permissive x-frame-options allows embedding", async () => {
  const { xFrameOptionsForbids } = await loadSubject();
  assert.equal(xFrameOptionsForbids(null), false);
  assert.equal(xFrameOptionsForbids(undefined), false);
  assert.equal(xFrameOptionsForbids(""), false);
  // ALLOW-FROM is obsolete; best-effort permissive
  assert.equal(xFrameOptionsForbids("ALLOW-FROM https://example.com"), false);
});

test("CSP frame-ancestors 'none' forbids embedding", async () => {
  const { cspForbidsFraming } = await loadSubject();
  assert.equal(
    cspForbidsFraming("default-src 'self'; frame-ancestors 'none'", "http://localhost:30141"),
    true,
  );
});

test("CSP frame-ancestors 'self' forbids cross-origin preview", async () => {
  const { cspForbidsFraming } = await loadSubject();
  assert.equal(
    cspForbidsFraming("frame-ancestors 'self'", "http://localhost:30141"),
    true,
  );
});

test("CSP frame-ancestors allowlist without our origin forbids embedding", async () => {
  const { cspForbidsFraming } = await loadSubject();
  assert.equal(
    cspForbidsFraming("frame-ancestors https://example.com https://other.org", "http://localhost:30141"),
    true,
  );
});

test("CSP frame-ancestors allowlist containing our origin allows embedding", async () => {
  const { cspForbidsFraming } = await loadSubject();
  assert.equal(
    cspForbidsFraming("frame-ancestors http://localhost:30141 https://example.com", "http://localhost:30141"),
    false,
  );
});

test("CSP without frame-ancestors directive allows embedding", async () => {
  const { cspForbidsFraming } = await loadSubject();
  assert.equal(
    cspForbidsFraming("default-src 'self'; script-src 'self'", "http://localhost:30141"),
    false,
  );
  assert.equal(cspForbidsFraming(null, "http://localhost:30141"), false);
});

test("combined urlForbidsEmbedding ORs header checks", async () => {
  const { urlForbidsEmbedding } = await loadSubject();
  const origin = "http://localhost:30141";
  assert.equal(urlForbidsEmbedding({ "x-frame-options": "DENY" }, origin), true);
  assert.equal(urlForbidsEmbedding({ "content-security-policy": "frame-ancestors 'none'" }, origin), true);
  assert.equal(urlForbidsEmbedding({}, origin), false);
  assert.equal(urlForbidsEmbedding({ "x-frame-options": null, "content-security-policy": null }, origin), false);
});
