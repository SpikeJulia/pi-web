import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { composeAttachmentMessage } = await jiti.import("./attachment-message.ts");

// PendingAttachment must carry the original `File` so the channel decision
// (image vs path) can be made from the client's MIME type — that is the
// only contract the upload pipeline guarantees on the way back in.
function pendingAttachment({ name, type, fileName, fileType }) {
  return {
    id: `att-${name}`,
    file: { name: fileName ?? name, type: fileType ?? type },
    previewUrl: "",
    status: "ready",
  };
}

function upload({ name, path, mimeType, data = null }) {
  return { name, path, mimeType, size: 1, data };
}

test("no attachments returns the user text unchanged and an empty images array", () => {
  const result = composeAttachmentMessage("hello world", [], []);
  assert.deepEqual(result, { message: "hello world", images: [] });
});

test("empty user text without attachments returns empty strings and no images", () => {
  const result = composeAttachmentMessage("", [], []);
  assert.deepEqual(result, { message: "", images: [] });
});

test("a single image attachment goes into the images field without appending a @path", () => {
  const pending = [pendingAttachment({ name: "shot.png", type: "image/png" })];
  const uploads = [
    upload({
      name: "shot.png",
      path: ".pi-uploads/sess-1/aabbccddeeff0011.png",
      mimeType: "image/png",
      data: "BASE64PAYLOAD",
    }),
  ];
  const result = composeAttachmentMessage("Look at this", pending, uploads);
  assert.equal(result.message, "Look at this");
  assert.equal(result.images.length, 1);
  assert.deepEqual(result.images[0], {
    type: "image",
    data: "BASE64PAYLOAD",
    mimeType: "image/png",
  });
  // ADR 0004: image-channel attachments must not be referenced in the
  // message text, even though the server stored the file under .pi-uploads.
  assert.doesNotMatch(result.message, /@\.pi-uploads/);
  assert.doesNotMatch(result.message, /aabbccddeeff0011/);
});

test("a single non-image attachment appends a single @path line", () => {
  const pending = [pendingAttachment({ name: "contract.pdf", type: "application/pdf" })];
  const uploads = [
    upload({
      name: "contract.pdf",
      path: ".pi-uploads/sess-1/1122334455667788.pdf",
      mimeType: "application/pdf",
      data: null,
    }),
  ];
  const result = composeAttachmentMessage("Please review", pending, uploads);
  assert.equal(result.message, "Please review\n@.pi-uploads/sess-1/1122334455667788.pdf");
  assert.deepEqual(result.images, []);
});

test("mixed image + non-image: image goes to images, path goes to text — one prompt, no duplication", () => {
  const pending = [
    pendingAttachment({ name: "shot.png", type: "image/png" }),
    pendingAttachment({ name: "contract.pdf", type: "application/pdf" }),
  ];
  const uploads = [
    upload({
      name: "shot.png",
      path: ".pi-uploads/sess-1/aabbccddeeff0011.png",
      mimeType: "image/png",
      data: "BASE64PAYLOAD",
    }),
    upload({
      name: "contract.pdf",
      path: ".pi-uploads/sess-1/1122334455667788.pdf",
      mimeType: "application/pdf",
      data: null,
    }),
  ];
  const result = composeAttachmentMessage("Compare these", pending, uploads);

  // Only the path-channel file appears in the message text.
  assert.equal(result.message, "Compare these\n@.pi-uploads/sess-1/1122334455667788.pdf");
  assert.doesNotMatch(result.message, /aabbccddeeff0011/);
  // Only the image-channel file appears in the images array.
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].data, "BASE64PAYLOAD");
  assert.equal(result.images[0].mimeType, "image/png");
});

test("multiple non-image attachments produce one @path line each, in order", () => {
  const pending = [
    pendingAttachment({ name: "a.txt", type: "text/plain" }),
    pendingAttachment({ name: "b.txt", type: "text/plain" }),
    pendingAttachment({ name: "c.txt", type: "text/plain" }),
  ];
  const uploads = [
    upload({ name: "a.txt", path: ".pi-uploads/s1/0000000000000001.txt", mimeType: "text/plain" }),
    upload({ name: "b.txt", path: ".pi-uploads/s1/0000000000000002.txt", mimeType: "text/plain" }),
    upload({ name: "c.txt", path: ".pi-uploads/s1/0000000000000003.txt", mimeType: "text/plain" }),
  ];
  const result = composeAttachmentMessage("Look at all three", pending, uploads);
  assert.equal(
    result.message,
    "Look at all three\n@.pi-uploads/s1/0000000000000001.txt\n@.pi-uploads/s1/0000000000000002.txt\n@.pi-uploads/s1/0000000000000003.txt",
  );
  assert.deepEqual(result.images, []);
});

test("path-channel alone with empty user text produces just the @path line, no leading newline", () => {
  const pending = [pendingAttachment({ name: "doc.pdf", type: "application/pdf" })];
  const uploads = [
    upload({ name: "doc.pdf", path: ".pi-uploads/s1/deadbeefcafebabe.pdf", mimeType: "application/pdf" }),
  ];
  const result = composeAttachmentMessage("", pending, uploads);
  assert.equal(result.message, "@.pi-uploads/s1/deadbeefcafebabe.pdf");
  assert.deepEqual(result.images, []);
});

test("image-channel alone with empty user text returns an empty message and the image in images", () => {
  const pending = [pendingAttachment({ name: "shot.png", type: "image/png" })];
  const uploads = [
    upload({
      name: "shot.png",
      path: ".pi-uploads/s1/aabbccddeeff0011.png",
      mimeType: "image/png",
      data: "BASE64",
    }),
  ];
  const result = composeAttachmentMessage("", pending, uploads);
  assert.equal(result.message, "");
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].data, "BASE64");
});

test("interleaved image + path + image + path produces correct image count and ordered path lines", () => {
  const pending = [
    pendingAttachment({ name: "a.png", type: "image/png" }),
    pendingAttachment({ name: "b.pdf", type: "application/pdf" }),
    pendingAttachment({ name: "c.png", type: "image/png" }),
    pendingAttachment({ name: "d.txt", type: "text/plain" }),
  ];
  const uploads = [
    upload({ name: "a.png", path: ".pi-uploads/s1/1111111111111111.png", mimeType: "image/png", data: "A" }),
    upload({ name: "b.pdf", path: ".pi-uploads/s1/2222222222222222.pdf", mimeType: "application/pdf" }),
    upload({ name: "c.png", path: ".pi-uploads/s1/3333333333333333.png", mimeType: "image/png", data: "C" }),
    upload({ name: "d.txt", path: ".pi-uploads/s1/4444444444444444.txt", mimeType: "text/plain" }),
  ];
  const result = composeAttachmentMessage("Mixed bag", pending, uploads);
  assert.equal(
    result.message,
    "Mixed bag\n@.pi-uploads/s1/2222222222222222.pdf\n@.pi-uploads/s1/4444444444444444.txt",
  );
  assert.equal(result.images.length, 2);
  assert.deepEqual(
    result.images.map((img) => img.data),
    ["A", "C"],
  );
});

test("image attachments with empty base64 from the server are skipped from the images array", () => {
  const pending = [pendingAttachment({ name: "broken.png", type: "image/png" })];
  const uploads = [
    upload({
      name: "broken.png",
      path: ".pi-uploads/s1/deadbeefdeadbeef.png",
      mimeType: "image/png",
      data: null, // server may have failed to encode
    }),
  ];
  const result = composeAttachmentMessage("See attached", pending, uploads);
  // No image in images because the upload has no base64 data.
  assert.deepEqual(result.images, []);
  // Image-channel rule still holds: path is NOT added to the message text.
  assert.equal(result.message, "See attached");
});

test("pending and uploads of different lengths throws — a programmer-error guard for the upload pipeline", () => {
  const pending = [pendingAttachment({ name: "a.txt", type: "text/plain" })];
  const uploads = [
    upload({ name: "a.txt", path: ".pi-uploads/s1/000000000000000a.txt", mimeType: "text/plain" }),
    upload({ name: "b.txt", path: ".pi-uploads/s1/000000000000000b.txt", mimeType: "text/plain" }),
  ];
  assert.throws(
    () => composeAttachmentMessage("hello", pending, uploads),
    /pending\.length .* does not match uploads\.length/,
  );
});

test("composeAttachmentMessage uses position pairing between pending and uploads — the i-th upload's data lives in the i-th image slot", () => {
  // Verify the contract directly: the data field of uploads[0] is what
  // shows up in result.images[0] when the corresponding pending[0] is
  // an image. The channel decision is made from the File's MIME, but
  // the payload and path values come from the matching upload record.
  const pending = [pendingAttachment({ name: "p.png", type: "image/png" })];
  const uploads = [
    upload({
      name: "p.png",
      path: ".pi-uploads/s1/aaaaaaaaaaaaaaaa.png",
      mimeType: "image/png",
      data: "FIRST-UPLOAD-BASE64",
    }),
  ];
  const first = composeAttachmentMessage("alpha", pending, uploads);
  assert.equal(first.images.length, 1);
  assert.equal(first.images[0].data, "FIRST-UPLOAD-BASE64");

  // Now with a second, distinct pending attachment in the same position
  // (length is still 1, but the upload pipeline has returned a different
  // payload). Compose must pick up the new data verbatim.
  const uploads2 = [
    upload({
      name: "p.png",
      path: ".pi-uploads/s1/bbbbbbbbbbbbbbbb.png",
      mimeType: "image/png",
      data: "SECOND-UPLOAD-BASE64",
    }),
  ];
  const second = composeAttachmentMessage("alpha", pending, uploads2);
  assert.equal(second.images[0].data, "SECOND-UPLOAD-BASE64");
  assert.notEqual(first.images[0].data, second.images[0].data);
});

test("path-channel composes with text that already ends in a newline — no double separator", () => {
  const pending = [pendingAttachment({ name: "a.txt", type: "text/plain" })];
  const uploads = [upload({ name: "a.txt", path: ".pi-uploads/s1/aaaaaaaaaaaaaaa0.txt", mimeType: "text/plain" })];
  const result = composeAttachmentMessage("note:\n", pending, uploads);
  // Exactly one "\n" between the trailing newline of the user text and
  // the @path line, no collapsing that would lose the user's blank line.
  assert.equal(result.message, "note:\n\n@.pi-uploads/s1/aaaaaaaaaaaaaaa0.txt");
});

// --- channel authority: server's `data` wins over client classification (P0 review finding) ---

test("a .png attachment whose file.type was empty is composed as an image when the server returns base64", () => {
  // Client-side classification by extension: .png → image.
  // Server-side encoding: returns base64 in `data` (channel decision made
  // from the same extension list). The composed payload must emit the
  // image and MUST NOT emit an @path line — otherwise the model would
  // never see the bytes.
  const pending = [pendingAttachment({ name: "shot.png", type: "", fileName: "shot.png", fileType: "" })];
  const uploads = [
    upload({
      name: "shot.png",
      path: ".pi-uploads/s1/aabbccddeeff0011.png",
      mimeType: "image/png",
      data: "BASE64PAYLOAD",
    }),
  ];
  const result = composeAttachmentMessage("See attached", pending, uploads);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].data, "BASE64PAYLOAD");
  assert.equal(result.images[0].mimeType, "image/png");
  assert.doesNotMatch(result.message, /@\.pi-uploads/);
  assert.doesNotMatch(result.message, /aabbccddeeff0011/);
});

test("a .png attachment whose file.type was octet-stream is composed as an image when the server returns base64", () => {
  // Real-world case: Windows file-manager drag produces
  // application/octet-stream for PNGs. The client extension check still
  // routes the file to image; the server returns base64; composition
  // must emit the image.
  const pending = [
    pendingAttachment({ name: "shot.png", type: "application/octet-stream" }),
  ];
  const uploads = [
    upload({
      name: "shot.png",
      path: ".pi-uploads/s1/aabbccddeeff0011.png",
      mimeType: "image/png",
      data: "BASE64PAYLOAD",
    }),
  ];
  const result = composeAttachmentMessage("", pending, uploads);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].data, "BASE64PAYLOAD");
  assert.equal(result.message, "");
});

test("an image-channel record with no base64 from the server is silently dropped (no path fallback)", () => {
  // Defensive: if the server returned data: null for what should be an
  // image, do not fall back to emitting @path — that would silently
  // change the channel the model sees. Drop the record.
  const pending = [pendingAttachment({ name: "broken.png", type: "image/png" })];
  const uploads = [
    upload({
      name: "broken.png",
      path: ".pi-uploads/s1/aabbccddeeff0011.png",
      mimeType: "image/png",
      data: null,
    }),
  ];
  const result = composeAttachmentMessage("hi", pending, uploads);
  assert.deepEqual(result.images, []);
  assert.equal(result.message, "hi");
  assert.doesNotMatch(result.message, /aabbccddeeff0011/);
});

test("a record whose extension says path but whose data carries base64 is composed as an image", () => {
  // Hypothetical mismatch (server changed policy but client is stale, or
  // server fallback encoded a non-image as base64). Server's data is
  // authoritative: prefer the image channel rather than emit a path
  // reference the model can't act on.
  const pending = [pendingAttachment({ name: "doc.pdf", type: "application/pdf" })];
  const uploads = [
    upload({
      name: "doc.pdf",
      path: ".pi-uploads/s1/1122334455667788.pdf",
      mimeType: "application/pdf",
      data: "BASE64PAYLOAD",
    }),
  ];
  const result = composeAttachmentMessage("Look", pending, uploads);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].data, "BASE64PAYLOAD");
  assert.equal(result.images[0].mimeType, "application/pdf");
  assert.doesNotMatch(result.message, /@\.pi-uploads/);
});

test("client and server share the image-extension set — .svg is path-channel on both sides", () => {
  // image/svg+xml in MIME-land; the server policy does NOT classify svg
  // as image, so the client must agree. Without the shared rule the
  // client would treat the file as image (MIME match) and the server
  // would treat it as path (extension mismatch) — silent image drop.
  const pending = [pendingAttachment({ name: "logo.svg", type: "image/svg+xml" })];
  const uploads = [
    upload({
      name: "logo.svg",
      path: ".pi-uploads/s1/aabbccddeeff0011.svg",
      mimeType: "image/svg+xml",
      data: null, // server saw it as path-channel
    }),
  ];
  const result = composeAttachmentMessage("", pending, uploads);
  assert.deepEqual(result.images, []);
  assert.equal(result.message, "@.pi-uploads/s1/aabbccddeeff0011.svg");
});
