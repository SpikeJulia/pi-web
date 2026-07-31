/**
 * Pure helpers that turn a user message's `content` into a flat list of
 * "attachment chips". Tickets 03/04 wrote files to
 * `<cwd>/.pi-uploads/<sessionId>/<storedName>` and the agent prompt for
 * path-channel attachments as a literal `@.pi-uploads/...` line; this module
 * reverses that to reconstruct chips for history rendering.
 *
 * Two channels are handled:
 *   - image:  `UserMessage.content` blocks whose `type === "image"` — the
 *             base64 payload is already in the message, so chips render
 *             inline thumbnails (see ADR-0004).
 *   - file:   matches of `@.pi-uploads/<sessionId>/<storedName>` inside
 *             message text — the stored name is opaque, so chips need a
 *             sidecar fetch to recover the original name / size / type.
 *
 * Both channels can appear in the same message. This module is pure
 * (no I/O, no React): `parseMessageAttachments` only inspects the message
 * payload, and `extractPathReferences` only inspects a string. Sidecar
 * resolution lives in `lib/sidecar-meta.ts` so it can be tested with a
 * fake fetch.
 */

import { formatAttachmentSize } from "./pending-attachments";
import type { ImageContent, UserMessage } from "./types";

/**
 * Re-export the shared byte-count formatter so history-rendering code
 * (and any future chip variant) does not grow a parallel implementation.
 * Aliased name keeps the chip-specific call sites readable.
 */
export const formatChipSize = formatAttachmentSize;

/**
 * Stored-name pattern: 16 lowercase hex chars (8 random bytes per
 * `generateStoredFileName`) plus an optional lowercase extension. We accept
 * the optional dot/ext so extensions-less uploads still match.
 */
const STORED_NAME_RE = /[0-9a-f]{16}(?:\.[A-Za-z0-9]+)?/;

/**
 * Session-id segment: anything URL-safe that does not contain a path
 * separator or `@`. Real session ids are UUIDs (`8-4-4-4-12`) but a few
 * fixtures and previews use slugs like `sess-1`, so we keep the match
 * permissive. The leading `@` is required — that is what distinguishes a
 * path reference from a coincidental mention of `.pi-uploads` in prose.
 */
const SESSION_ID_RE = /[A-Za-z0-9_-]+/;

/**
 * A single `@.pi-uploads/<sessionId>/<storedName>` reference extracted from
 * message text. `start` and `end` are UTF-16 code-unit offsets into the
 * original text and are stable across passes so the caller can splice the
 * reference out of the visible body without leaving duplicates behind.
 */
export interface PathReference {
  /** Raw text of the reference, including the leading `@`. */
  raw: string;
  sessionId: string;
  storedName: string;
  /** Inclusive start offset of the leading `@` in the source text. */
  start: number;
  /** Exclusive end offset (one past the last char of `storedName`). */
  end: number;
}

/**
 * Render-side attachment chip. Images carry everything they need to draw
 * a thumbnail inline; files defer to the caller for sidecar resolution
 * (kept pure here so this module never touches the network).
 *
 * `key` is a stable React key — callers MUST key their lists by it so
 * React re-uses chips across re-renders as sidecar metadata arrives.
 */
export interface ParsedAttachment {
  key: string;
  kind: "image" | "file";
  /** Image channel: base64 data URL (no `data:` prefix variant; see `src`). */
  image?: ImageContent;
  /** File channel: parsed reference (always set when kind === "file"). */
  pathRef?: PathReference;
  /** Image channel: ready-to-render `src` for `<img>`. */
  src?: string;
}

/**
 * Build the global regex used to scan message text. Constructed lazily so
 * the regex object isn't rebuilt on every call. The pattern deliberately
 * accepts only one stored-name per reference (no nested paths) so we
 * don't over-match paths like `.pi-uploads/foo/.pi-uploads/bar/...`.
 */
const PATH_REF_RE = new RegExp(
  `@\\.pi-uploads/(${SESSION_ID_RE.source})/(${STORED_NAME_RE.source})`,
  "g",
);

/**
 * Find every `@.pi-uploads/<sessionId>/<storedName>` reference in `text`.
 * Returns the references in source order with their byte ranges so the
 * caller can strip them when rendering the message body.
 *
 * Whitespace and trailing newlines are NOT part of the match — the caller
 * decides how to collapse leftover blank lines after stripping.
 */
export function extractPathReferences(text: string): PathReference[] {
  const out: PathReference[] = [];
  if (!text) return out;
  PATH_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_REF_RE.exec(text)) !== null) {
    out.push({
      raw: match[0],
      sessionId: match[1],
      storedName: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return out;
}

/**
 * Strip every path reference from `text`. Returns a new string with the
 * references removed; the rest of the text (including punctuation and
 * line breaks that surrounded the reference) is preserved. Adjacent
 * whitespace runs and trailing/leading blank lines produced by the strip
 * are not collapsed here — markdown rendering handles that naturally, and
 * leaving the raw whitespace lets the caller inspect what was removed.
 */
export function stripPathReferences(text: string, refs: PathReference[]): string {
  if (!text || refs.length === 0) return text;
  // Sort by start descending so splicing does not invalidate later offsets.
  const sorted = [...refs].sort((a, b) => b.start - a.start);
  let result = text;
  for (const ref of sorted) {
    result = result.slice(0, ref.start) + result.slice(ref.end);
  }
  return result;
}

/**
 * Decode the image payload from an `ImageContent` block into a renderable
 * `data:` URL. Mirrors the existing logic in `MessageView` so the chips
 * rendered here look identical to the legacy inline image rendering.
 *
 * Returns an empty string when the block has no payload — callers should
 * treat that as "no image to show".
 */
export function imageBlockToSrc(image: ImageContent): string {
  const flat = image as unknown as { data?: string; mimeType?: string };
  if (image.source) {
    if (image.source.type === "base64") {
      const mediaType = image.source.media_type ?? "image/png";
      const data = image.source.data ?? "";
      return `data:${mediaType};base64,${data}`;
    }
    return image.source.url ?? "";
  }
  if (flat.data) {
    return `data:${flat.mimeType ?? "image/png"};base64,${flat.data}`;
  }
  return "";
}

/**
 * Re-export the image-source helper under a chip-friendly name. Centralizes
 * the data-URL decoding logic so `MessageView` does not grow a parallel
 * copy. The two implementations were identical before the refactor; this
 * keeps the chip call site readable while preventing future drift.
 */
export const attachmentImageSrc = imageBlockToSrc;

/**
 * Pull image blocks out of a user message payload. Returns the blocks in
 * the order they appear; the caller decides whether to render them inline
 * (current behavior) or as chips (this ticket keeps both: thumbnails for
 * image channel, but as proper chips in the chip strip).
 */
export function imageBlocksFromMessage(message: UserMessage): ImageContent[] {
  if (typeof message.content === "string") return [];
  return message.content.filter((b): b is ImageContent => b.type === "image");
}

/**
 * Pull plain text out of a user message payload, mirroring `getMessageText`
 * in `MessageView`. Returns an empty string when the content is not a
 * text/image union.
 */
export function textFromMessage(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");
}

/**
 * Build the full chip list for a user message. Image blocks become image
 * chips (with a ready-to-render `src`); path references become file chips
 * keyed by `sessionId/storedName`.
 *
 * Stable order: image blocks keep their payload order, then path references
 * in source order. Duplicate references (e.g. if a model echoes the path
 * twice) collapse to a single chip — the chip strip is supposed to mirror
 * what was attached, not double-render the same attachment.
 */
export function parseMessageAttachments(message: UserMessage): ParsedAttachment[] {
  const out: ParsedAttachment[] = [];
  const seenFileKeys = new Set<string>();
  const seenImageKeys = new Set<string>();

  for (const image of imageBlocksFromMessage(message)) {
    // The image payload itself is the only stable key — the message doesn't
    // give us a stored name for image-channel attachments.
    const data = image.source?.data ?? (image as unknown as { data?: string }).data ?? "";
    const key = `img:${data.length}:${data.slice(0, 16)}`;
    if (seenImageKeys.has(key)) continue;
    seenImageKeys.add(key);
    out.push({ key, kind: "image", image, src: imageBlockToSrc(image) });
  }

  const text = textFromMessage(message);
  for (const ref of extractPathReferences(text)) {
    const key = `file:${ref.sessionId}/${ref.storedName}`;
    if (seenFileKeys.has(key)) continue;
    seenFileKeys.add(key);
    out.push({ key, kind: "file", pathRef: ref });
  }

  return out;
}

/**
 * Build the visible text body for a user message: the original text with
 * every path reference removed. This is the string that should be passed
 * to `MarkdownBody` so the agent's literal `@.pi-uploads/...` lines do not
 * show up in the rendered bubble. Markdown will collapse any leftover
 * whitespace naturally.
 */
export function visibleMessageText(message: UserMessage): string {
  const text = textFromMessage(message);
  if (!text) return "";
  const refs = extractPathReferences(text);
  if (refs.length === 0) return text;
  return stripPathReferences(text, refs);
}