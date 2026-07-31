import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput } = await jiti.import("./ChatInput.tsx");
// Match ChatInput's own import spec so jiti's module cache returns the same
// draft-store / pending-attachments instances the component reads from.
// Without the matching path a fresh Map() lives behind the alias and our
// setDraft() would never be visible to the rendered component.
const draftStoreModule = await jiti.import("@/lib/draft-store");
const pendingAttachmentsModule = await jiti.import("@/lib/pending-attachments");
const setDraft = draftStoreModule.setDraft;
const getDraft = draftStoreModule.getDraft;
const { MAX_ATTACHMENTS_PER_MESSAGE } = pendingAttachmentsModule;

function render(props) {
  return renderToStaticMarkup(React.createElement(ChatInput, props));
}

const baseProps = {
  onSend: () => {},
  onAbort: () => {},
  isStreaming: false,
  model: null,
  modelNames: { "test-model": "Test Model" },
  modelList: [{ id: "test-model", name: "Test Model", provider: "test" }],
  onModelChange: () => {},
  soundEnabled: false,
  onSoundToggle: () => {},
  onAudioUnlock: () => {},
};

test("paperclip button replaces the image-only attach icon", () => {
  const html = render({ ...baseProps, draftKey: "test:paperclip" });
  assert.match(html, /data-testid="paperclip-button"/);
  assert.match(html, /aria-label="Attach files"/);
  // Old image-only photo icon (rect + circle + polyline) is gone.
  assert.doesNotMatch(html, /<rect x="3" y="3" width="18" height="18"/);
  // New paperclip icon path is present (the curved paperclip shape).
  assert.match(html, /M21\.44 11\.05/);
});

test("file input has no image MIME restriction so any file type can be attached", () => {
  const html = render({ ...baseProps, draftKey: "test:no-accept" });
  const match = html.match(/<input[^>]*type="file"[^>]*>/);
  assert.ok(match, "expected a file input in the markup");
  assert.doesNotMatch(match[0], /accept="image\/\*"/);
  assert.match(match[0], /multiple/);
});

test("paperclip title advertises the per-message cap", () => {
  const html = render({ ...baseProps, draftKey: "test:cap-title" });
  assert.match(html, new RegExp(`title="Attach files \\(up to ${MAX_ATTACHMENTS_PER_MESSAGE} per message\\)"`));
});

test("image attachment restored from draft renders as a chip with thumbnail", () => {
  const draftKey = "test:chip-image";
  setDraft(draftKey, {
    value: "",
    images: [{ data: "iVBORw0KGgo", mimeType: "image/png" }],
  });
  // Round-trip guard: confirms the test sees the same Map the component
  // reads from. A future tsconfig / jiti path change would silently
  // regress the chip rendering otherwise.
  assert.equal(getDraft(draftKey)?.images.length, 1);
  const html = render({ ...baseProps, draftKey });
  assert.match(html, /border-radius:7/, "chip wrapper rendered");
  assert.match(html, /width:28/, "image thumbnail sized at 28px");
});

test("paperclip button and hidden file input are wired together for picker-driven add", () => {
  const html = render({ ...baseProps, draftKey: "test:wiring" });
  // Both controls must exist; the picker button calls .click() on the
  // hidden input, the input drives processFiles via onChange.
  assert.match(html, /data-testid="paperclip-button"/);
  assert.match(html, /<input[^>]*type="file"[^>]*multiple/);
});

test("onSend signature accepts a PendingAttachment list (ticket 04 upload pipeline hook)", () => {
  // Renders the component with an onSend that uses the new ticket-04
  // signature. Rendering must not crash; the call surfaces only when a
  // user actually clicks Send, which is not exercised here.
  const html = render({
    ...baseProps,
    draftKey: "test:ticket04-signature",
    onSend: (msg, pending) => {
      // We don't need to assert the wire contents here — that lives in
      // `lib/attachment-message.test.mjs`. This test pins the contract
      // that ChatInput is allowed to pass an array as the second arg.
      void pending;
      return "ok";
    },
  });
  assert.match(html, /data-testid="paperclip-button"/);
});