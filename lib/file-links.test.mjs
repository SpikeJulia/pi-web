import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-links.ts");
}

test("resolves absolute markdown file links and strips line suffixes", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/project/components/MarkdownBody.tsx:36",
      "/home/me/project",
    ),
    "/home/me/project/components/MarkdownBody.tsx",
  );
});

test("resolves absolute file links outside cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/.codex/config.toml:12",
      "/home/me/project",
    ),
    "/home/me/.codex/config.toml",
  );
});

test("resolves relative markdown file links against cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("components/AppShell.tsx#L42", "/home/me/project"),
    "/home/me/project/components/AppShell.tsx",
  );
});

test("does not let relative links escape cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../outside.md", "/home/me/project"),
    null,
  );
});

test("resolves preview links from the file directory within the project root", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../file.js", "/home/me/project/docs/nested", "/home/me/project"),
    "/home/me/project/docs/file.js",
  );
  assert.equal(
    resolveLocalFileHref("../../../outside.js", "/home/me/project/docs/nested", "/home/me/project"),
    null,
  );
});

test("does not treat app or external URLs as file links", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(resolveLocalFileHref("/api/files/home/me/project/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("https://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("ftp://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("//example.com/a.ts", "/home/me/project"), null);
});

test("resolves Windows file URLs without a synthetic leading slash", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file:///C:/Users/me/project/file.txt:10", "C:/Users/me/project"),
    "C:/Users/me/project/file.txt",
  );
});

test("resolves UNC file URLs and backslash UNC paths", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file://server/share/project/file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
  assert.equal(
    resolveLocalFileHref("\\\\server\\share\\project\\file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
});

test("classifies http(s) links as external URLs, keeps other schemes ordinary", async () => {
  const { isExternalUrl } = await loadSubject();

  assert.equal(isExternalUrl("https://example.com/a.ts"), true);
  assert.equal(isExternalUrl("http://example.com/docs#top"), true);
  // mailto/ftp are not embeddable in an iframe; they stay ordinary links.
  assert.equal(isExternalUrl("mailto:hi@example.com"), false);
  assert.equal(isExternalUrl("ftp://example.com/file"), false);
  assert.equal(isExternalUrl("javascript:alert(1)"), false);
  assert.equal(isExternalUrl("data:text/html,hi"), false);
});

test("does not classify local or app links as external URLs", async () => {
  const { isExternalUrl } = await loadSubject();

  assert.equal(isExternalUrl("/home/me/project/a.ts"), false);
  assert.equal(isExternalUrl("./a.ts"), false);
  assert.equal(isExternalUrl("components/AppShell.tsx"), false);
  assert.equal(isExternalUrl("/api/files/home/me/project/a.ts"), false);
  assert.equal(isExternalUrl("#section"), false);
  assert.equal(isExternalUrl(undefined), false);
});

test("normalizes external URLs for tab dedup", async () => {
  const { normalizePreviewUrl } = await loadSubject();

  assert.equal(
    normalizePreviewUrl("https://Example.COM/Path/"),
    "https://example.com/Path",
  );
  assert.equal(
    normalizePreviewUrl("HTTPS://example.com/docs?q=1#top"),
    "https://example.com/docs?q=1",
  );
  assert.equal(
    normalizePreviewUrl("http://example.com:3000/app/"),
    "http://example.com:3000/app",
  );
  assert.equal(normalizePreviewUrl("https://example.com"), "https://example.com");
});
