import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView, ImageChip } = await jiti.import("./MessageView.tsx");

function renderMessage(props) {
  return renderToStaticMarkup(React.createElement(MessageView, props));
}

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
const CWD = "/tmp/proj";

// --- image-channel chips ---

test("user message with image attachment renders a thumbnail chip", () => {
  const html = renderMessage({
    message: {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ],
    },
    cwd: CWD,
    sessionId: SESSION_ID,
  });
  // The strip wrapper carries the data attribute so the parent can target it.
  assert.match(html, /data-attachment-strip="true"/);
  assert.match(html, /data-attachment-kind="image"/);
  // The thumbnail is rendered as an <img> with the base64 data URL.
  assert.match(html, /<img[^>]+src="data:image\/png;base64,AAAA"/);
});

test("image chips invoke the existing file-preview callback with their source", () => {
  const attachment = {
    key: "img:4:AAAA",
    kind: "image",
    src: "data:image/png;base64,AAAA",
  };
  let opened = null;
  const element = ImageChip({ attachment, onOpenFile: (source) => { opened = source; } });

  assert.equal(element.props.disabled, false);
  element.props.onClick();
  assert.equal(opened, attachment.src);
});

test("user message with multiple image attachments renders one chip per image", () => {
  const html = renderMessage({
    message: {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "A" } },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "B" } },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "C" } },
      ],
    },
    cwd: CWD,
    sessionId: SESSION_ID,
  });
  const imageChips = html.match(/data-attachment-kind="image"/g) ?? [];
  assert.equal(imageChips.length, 3);
});

// --- path-channel chips (degraded sidecar state) ---

test("user message with path reference renders a file chip", () => {
  const html = renderMessage({
    message: {
      role: "user",
      content: "Please review.\n@.pi-uploads/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4e5f6a7b8.pdf\nThanks.",
    },
    cwd: CWD,
    sessionId: SESSION_ID,
  });
  // Strip wrapper is present.
  assert.match(html, /data-attachment-strip="true"/);
  // One file chip, marked as degraded (sidecar not yet resolved in SSR).
  const fileChips = html.match(/data-attachment-kind="file"/g) ?? [];
  assert.equal(fileChips.length, 1);
  assert.match(html, /data-attachment-degraded="true"/);
  // The stored name is shown as the fallback when metadata is missing.
  assert.match(html, />a1b2c3d4e5f6a7b8\.pdf</);
  // A "missing metadata" hint helps the user understand the chip state.
  assert.match(html, /missing metadata/);
});

test("the raw @.pi-uploads/... text is not present in the visible message body", () => {
  const html = renderMessage({
    message: {
      role: "user",
      content: "Please review.\n@.pi-uploads/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4e5f6a7b8.pdf\nThanks.",
    },
    cwd: CWD,
    sessionId: SESSION_ID,
  });
  // The literal reference must not appear in the rendered text content
  // (we strip it before handing the text to MarkdownBody).
  assert.doesNotMatch(html, /@\.pi-uploads\/550e8400-e29b-41d4-a716-446655440000\/a1b2c3d4e5f6a7b8\.pdf/);
  // The surrounding text is still rendered.
  assert.match(html, /Please review\./);
  assert.match(html, /Thanks\./);
});

test("multiple path references render one chip per unique attachment", () => {
  const html = renderMessage({
    message: {
      role: "user",
      content: [
        "@.pi-uploads/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4e5f6a7b8.pdf",
        "@.pi-uploads/550e8400-e29b-41d4-a716-446655440000/bbbbbbbbbbbbbbbb.docx",
        "@.pi-uploads/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4e5f6a7b8.pdf",
      ].join("\n"),
    },
    cwd: CWD,
    sessionId: SESSION_ID,
  });
  const fileChips = html.match(/data-attachment-kind="file"/g) ?? [];
  assert.equal(fileChips.length, 2, "duplicate path references collapse to a single chip");
});

test("file chips carry a data attribute so the parent can wire the open-file handler", () => {
  const html = renderMessage({
    message: {
      role: "user",
      content: "@.pi-uploads/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4e5f6a7b8.pdf",
    },
    cwd: CWD,
    sessionId: SESSION_ID,
  });
  // Stable key derived from sessionId + storedName so the chip can be
  // matched to its onOpenFile handler across re-renders.
  assert.match(html, /data-attachment-key="file:550e8400-e29b-41d4-a716-446655440000\/a1b2c3d4e5f6a7b8\.pdf"/);
});

// --- combined + edge cases ---

test("user message with image + path reference renders both chips", () => {
  const html = renderMessage({
    message: {
      role: "user",
      content: [
        { type: "text", text: "Look:\n@.pi-uploads/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4e5f6a7b8.pdf" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ],
    },
    cwd: CWD,
    sessionId: SESSION_ID,
  });
  assert.match(html, /data-attachment-kind="image"/);
  assert.match(html, /data-attachment-kind="file"/);
  // Text body has the path reference stripped but the surrounding text remains.
  assert.doesNotMatch(html, /@\.pi-uploads\/550e8400-e29b-41d4-a716-446655440000\/a1b2c3d4e5f6a7b8\.pdf/);
  assert.match(html, /Look:/);
});

test("plain text message without attachments renders no chip strip", () => {
  const html = renderMessage({
    message: { role: "user", content: "no attachments here" },
    cwd: CWD,
    sessionId: SESSION_ID,
  });
  assert.doesNotMatch(html, /data-attachment-strip/);
  // The message text is still rendered.
  assert.match(html, /no attachments here/);
});

test("file chips degrade gracefully when sessionId is missing (no clickable target)", () => {
  const html = renderMessage({
    message: {
      role: "user",
      content: "@.pi-uploads/sess-1/aaaaaaaaaaaaaaaa.pdf",
    },
    cwd: CWD,
    // No sessionId provided — chip cannot resolve absolute path.
  });
  // Chip still renders in degraded mode and shows the stored name.
  assert.match(html, /data-attachment-kind="file"/);
  assert.match(html, />aaaaaaaaaaaaaaaa\.pdf</);
  assert.match(html, /data-attachment-degraded="true"/);
});

// --- FileChip rendered in isolation with sidecar metadata ---

const { FileChip } = await jiti.import("./MessageView.tsx");

function renderFileChip({ meta, cwd = CWD, sessionId = SESSION_ID, onOpenFile = () => {} }) {
  const attachment = {
    key: "file:test/ssssssssssssssss.pdf",
    kind: "file",
    pathRef: {
      raw: "@.pi-uploads/test/ssssssssssssssss.pdf",
      sessionId: "test",
      storedName: "ssssssssssssssss.pdf",
      start: 0,
      end: 39,
    },
  };
  return renderToStaticMarkup(
    React.createElement(FileChip, { attachment, cwd, sessionId, meta, onOpenFile }),
  );
}

test("FileChip with resolved sidecar shows the original name and size", () => {
  const html = renderFileChip({
    meta: {
      originalName: "contract.pdf",
      mimeType: "application/pdf",
      size: 12345,
      uploadedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  // Original name is shown — not the stored name.
  assert.match(html, />contract\.pdf</);
  assert.doesNotMatch(html, />ssssssssssssssss\.pdf</);
  // Size is rendered in human-friendly units.
  assert.match(html, /12\.1 KB/);
  // MIME badge shows the file type.
  assert.match(html, />PDF</);
  // Not in degraded mode anymore.
  assert.match(html, /data-attachment-degraded="false"/);
});

test("FileChip with resolved sidecar stays clickable (no missing-metadata hint)", () => {
  const html = renderFileChip({
    meta: {
      originalName: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 2_500_000,
      uploadedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  assert.doesNotMatch(html, /missing metadata/);
  // The button is not disabled when metadata is present.
  assert.match(html, /<button[^>]+type="button"/);
  assert.doesNotMatch(html, /<button[^>]+type="button"[^>]*\sdisabled/);
  // Size formatting kicks in past 1MB.
  assert.match(html, /2\.4 MB/);
});

test("FileChip with null meta (resolved as missing) shows the stored name fallback", () => {
  const html = renderFileChip({ meta: null });
  assert.match(html, />ssssssssssssssss\.pdf</);
  assert.match(html, /data-attachment-degraded="true"/);
  assert.match(html, /missing metadata/);
});