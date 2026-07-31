import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  chatDraftImageToFile,
  serializeChatDraftImages,
} = await jiti.import("./draft-store.ts");

test("serializeChatDraftImages persists runtime image bytes, MIME type, and original name", async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const images = await serializeChatDraftImages([
    {
      file: {
        name: "pasted-shot.png",
        type: "image/png",
        arrayBuffer: async () => bytes.buffer,
      },
    },
    {
      file: {
        name: "notes.pdf",
        type: "application/pdf",
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      },
    },
  ]);

  assert.deepEqual(images, [{
    data: "iVBORw==",
    mimeType: "image/png",
    name: "pasted-shot.png",
  }]);
});

test("chatDraftImageToFile restores uploadable image bytes and filename", async () => {
  const file = chatDraftImageToFile({
    data: "AQIDBA==",
    mimeType: "image/png",
    name: "reload.png",
  });

  assert.equal(file.name, "reload.png");
  assert.equal(file.type, "image/png");
  assert.deepEqual(Array.from(new Uint8Array(await file.arrayBuffer())), [1, 2, 3, 4]);
});

test("legacy draft images without a name receive an extension-bearing fallback", () => {
  const file = chatDraftImageToFile({ data: "AA==", mimeType: "image/jpeg" });
  assert.equal(file.name, "image.jpg");
});
