import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  extractPathReferences,
  stripPathReferences,
  parseMessageAttachments,
  visibleMessageText,
  imageBlockToSrc,
  textFromMessage,
  imageBlocksFromMessage,
} = await jiti.import("./attachment-references.ts");

// --- extractPathReferences ---

test("extractPathReferences finds a single reference and reports offsets", () => {
  const text = "Please read @.pi-uploads/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4e5f6a7b8.pdf and summarize.";
  const refs = extractPathReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].sessionId, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(refs[0].storedName, "a1b2c3d4e5f6a7b8.pdf");
  assert.equal(refs[0].raw, "@.pi-uploads/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4e5f6a7b8.pdf");
  // Offsets must point back into the original text.
  assert.equal(text.slice(refs[0].start, refs[0].end), refs[0].raw);
});

test("extractPathReferences finds multiple references in source order", () => {
  const text = [
    "Files:",
    "@.pi-uploads/sess-A/0000000000000001.pdf",
    "@.pi-uploads/sess-A/0000000000000002.docx",
    "@.pi-uploads/sess-B/0000000000000003.png",
  ].join("\n");
  const refs = extractPathReferences(text);
  assert.equal(refs.length, 3);
  assert.deepEqual(refs.map((r) => r.storedName), [
    "0000000000000001.pdf",
    "0000000000000002.docx",
    "0000000000000003.png",
  ]);
  assert.ok(refs[0].start < refs[1].start);
  assert.ok(refs[1].start < refs[2].start);
});

test("extractPathReferences accepts extensionless stored names", () => {
  const refs = extractPathReferences(
    "@.pi-uploads/sess-1/aaaaaaaaaaaaaaaa",
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].storedName, "aaaaaaaaaaaaaaaa");
});

test("extractPathReferences accepts slug session ids and lowercase extensions", () => {
  const refs = extractPathReferences(
    "@.pi-uploads/sess-42/abcdef0123456789.pdf",
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].sessionId, "sess-42");
  assert.equal(refs[0].storedName, "abcdef0123456789.pdf");
});

test("extractPathReferences rejects uppercase hex stored names (real generator is lowercase)", () => {
  // generateStoredFileName always lowercases the extension and uses
  // `randomBytes(...).toString("hex")`, which is lowercase. History
  // should never see uppercase; if it does, the reference is bogus.
  assert.deepEqual(
    extractPathReferences("@.pi-uploads/sess/ABCDEF1234567890.PDF"),
    [],
  );
});

test("extractPathReferences returns no matches for unrelated text", () => {
  assert.deepEqual(extractPathReferences(""), []);
  assert.deepEqual(extractPathReferences("hello world"), []);
  assert.deepEqual(
    extractPathReferences("see `.pi-uploads/foo/0000000000000000.pdf`"),
    [],
    "references without a leading @ must not match",
  );
  assert.deepEqual(
    extractPathReferences("@/path/to/somewhere/else.txt"),
    [],
    "references must include .pi-uploads/ segment",
  );
});

test("extractPathReferences does not over-match nested paths", () => {
  // If a stored name happened to look like `.pi-uploads/...` (it cannot, but
  // make sure the regex doesn't swallow outer @ if someone writes an
  // embedded path-like literal).
  const refs = extractPathReferences(
    "note: `.pi-uploads/inner/0000000000000000.pdf` is not a reference",
  );
  assert.deepEqual(refs, []);
});

// --- stripPathReferences ---

test("stripPathReferences removes every reference and keeps surrounding text", () => {
  const text = "before @.pi-uploads/sess/0000000000000001.pdf middle @.pi-uploads/sess/0000000000000002.pdf after";
  const refs = extractPathReferences(text);
  const stripped = stripPathReferences(text, refs);
  assert.equal(stripped, "before  middle  after");
});

test("stripPathReferences handles a lone reference on its own line", () => {
  const text = "Summary:\n@.pi-uploads/sess/0000000000000001.pdf\n\nThanks.";
  const refs = extractPathReferences(text);
  const stripped = stripPathReferences(text, refs);
  assert.equal(stripped, "Summary:\n\n\nThanks.");
});

test("stripPathReferences is a no-op for text with no references", () => {
  const text = "no references here";
  assert.equal(stripPathReferences(text, []), text);
  assert.equal(stripPathReferences(text, []), text);
});

// --- parseMessageAttachments ---

test("parseMessageAttachments returns image chips for image blocks", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Look at this:" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AAA" },
      },
    ],
  };
  const chips = parseMessageAttachments(message);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, "image");
  assert.match(chips[0].src ?? "", /^data:image\/png;base64,AAA$/);
  assert.ok(chips[0].key.startsWith("img:"));
});

test("parseMessageAttachments handles the legacy flat image payload", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "BBB", mimeType: "image/jpeg" },
    ],
  };
  const chips = parseMessageAttachments(message);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, "image");
  assert.match(chips[0].src ?? "", /^data:image\/jpeg;base64,BBB$/);
});

test("parseMessageAttachments deduplicates identical image payloads", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "BBB" } },
    ],
  };
  const chips = parseMessageAttachments(message);
  assert.equal(chips.length, 2, "duplicate image payload must collapse to one chip");
  assert.equal(chips.filter((c) => c.kind === "image").length, 2);
});

test("parseMessageAttachments returns file chips for path references in text", () => {
  const message = {
    role: "user",
    content:
      "Hi!\n@.pi-uploads/sess/0000000000000001.pdf\n@.pi-uploads/sess/0000000000000002.docx",
  };
  const chips = parseMessageAttachments(message);
  assert.equal(chips.length, 2);
  assert.equal(chips[0].kind, "file");
  assert.equal(chips[0].pathRef?.sessionId, "sess");
  assert.equal(chips[0].pathRef?.storedName, "0000000000000001.pdf");
  assert.equal(chips[1].kind, "file");
  assert.equal(chips[1].pathRef?.storedName, "0000000000000002.docx");
});

test("parseMessageAttachments combines image chips and file chips", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "See these:\n@.pi-uploads/sess/0000000000000001.pdf" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
    ],
  };
  const chips = parseMessageAttachments(message);
  assert.equal(chips.length, 2);
  // Image block comes first because images are processed before path refs.
  assert.equal(chips[0].kind, "image");
  assert.equal(chips[1].kind, "file");
});

test("parseMessageAttachments deduplicates duplicate path references", () => {
  const ref = "@.pi-uploads/sess/0000000000000001.pdf";
  const message = {
    role: "user",
    content: `${ref}\n${ref}\n${ref}`,
  };
  const chips = parseMessageAttachments(message);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, "file");
});

test("parseMessageAttachments returns empty for text-only message", () => {
  const message = { role: "user", content: "hello" };
  assert.deepEqual(parseMessageAttachments(message), []);
});

// --- visibleMessageText ---

test("visibleMessageText returns original text when no path refs", () => {
  const message = { role: "user", content: "hello world" };
  assert.equal(visibleMessageText(message), "hello world");
});

test("visibleMessageText strips path refs from a message body", () => {
  const message = {
    role: "user",
    content: "Please review.\n@.pi-uploads/sess/0000000000000001.pdf\nThanks.",
  };
  assert.equal(visibleMessageText(message), "Please review.\n\nThanks.");
});

test("visibleMessageText preserves non-text blocks", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Look:\n@.pi-uploads/sess/0000000000000001.pdf" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
    ],
  };
  // We only strip from the joined text portion — image blocks remain
  // untouched in the payload.
  const messageText = visibleMessageText(message);
  assert.equal(messageText, "Look:\n");
  assert.equal(message.content.length, 2, "input payload is not mutated");
});

// --- lower-level helpers ---

test("imageBlockToSrc handles base64, url, and flat payloads", () => {
  assert.match(imageBlockToSrc({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }), /^data:image\/png;base64,AAA$/);
  assert.equal(imageBlockToSrc({ type: "image", source: { type: "url", url: "https://x/y.png" } }), "https://x/y.png");
  assert.match(imageBlockToSrc({ type: "image", data: "BBB", mimeType: "image/jpeg" }), /^data:image\/jpeg;base64,BBB$/);
  // Empty base64 block: the wrapper still produces a (broken) data URL —
  // callers should detect that and skip rendering the chip.
  assert.match(imageBlockToSrc({ type: "image", source: { type: "base64", media_type: "image/png" } }), /^data:image\/png;base64,$/);
});

test("textFromMessage joins all text blocks with newlines", () => {
  assert.equal(textFromMessage({ role: "user", content: "single" }), "single");
  assert.equal(
    textFromMessage({
      role: "user",
      content: [
        { type: "text", text: "first" },
        { type: "image", source: { type: "url", url: "x" } },
        { type: "text", text: "second" },
      ],
    }),
    "first\nsecond",
  );
});

test("imageBlocksFromMessage returns only image blocks in order", () => {
  const blocks = imageBlocksFromMessage({
    role: "user",
    content: [
      { type: "text", text: "hi" },
      { type: "image", source: { type: "url", url: "a" } },
      { type: "image", source: { type: "url", url: "b" } },
    ],
  });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].source.type, "url");
});