// Pure composition for outgoing attachment-aware prompts.
//
// Ticket 04. Given the user text, the list of pending attachments (the
// `File` objects held in memory until send), and the parallel list of
// upload records returned by POST /api/file-upload, produce the
// `{ message, images }` payload the agent prompt command expects.
//
// Both channels from ADR 0001 / 0004 are handled here:
//
//   - Image-channel attachments (any `image/*` MIME on the original File)
//     become entries in `images` using the server-returned base64, and
//     contribute nothing to the message text. The model sees the inline
//     image, not a path — avoids the "should I read the path or look at
//     the image?" double-processing trap documented in ADR 0004.
//
//   - Path-channel attachments contribute a single `\n@<path>` line each
//     in the message text (one per file, in the order they were
//     attached). The model can resolve the path with its tools.
//
// No-attachments calls short-circuit: the user text is returned unchanged
// and the images array is empty.
//
// `pending` and `uploads` MUST be in the same order — index-by-index
// pairing is the contract that ties the original File's MIME (image vs
// path) to the server's stored record. A length mismatch throws: the
// pairing is the caller's responsibility (the upload pipeline is the
// only producer of these two arrays in lockstep).

import { isImageExtension } from "./file-types";
import type { PendingAttachment } from "./pending-attachments";

/**
 * Record returned by `POST /api/file-upload` for a single stored file.
 * Mirrors the server-side `FileUploadRecord` shape declared in
 * `app/api/file-upload/route.ts`. Image-channel files carry the
 * base64-encoded bytes (no data URL prefix); path-channel files carry
 * `data: null`.
 */
export interface UploadRecord {
  /** Original filename from the client (the server does not write this name to disk). */
  name: string;
  /** Posix-style relative path the agent can resolve with `@`, e.g. `.pi-uploads/<sessionId>/<storedName>`. */
  path: string;
  mimeType: string;
  size: number;
  /** Base64 bytes (no `data:` prefix) when the file is an image, otherwise null. */
  data: string | null;
}

/**
 * A single image block for the agent prompt's `images` field. Mirrors the
 * shape the `sendAgentCommand` plumbing already expects: `{ type: "image",
 * data: base64, mimeType: string }`.
 */
export interface PromptImage {
  type: "image";
  data: string;
  mimeType: string;
}

/**
 * The composed outgoing prompt. `message` carries user text plus any
 * `@<path>` lines; `images` is empty unless at least one image-channel
 * attachment was uploaded successfully.
 */
export interface ComposedAttachmentMessage {
  message: string;
  images: PromptImage[];
}

/**
 * Pure function — see module header for the full contract. This module
 * is unit-tested in `attachment-message.test.mjs`.
 */
export function composeAttachmentMessage(
  userText: string,
  pending: PendingAttachment[],
  uploads: UploadRecord[],
): ComposedAttachmentMessage {
  if (pending.length === 0) {
    return { message: userText, images: [] };
  }
  if (pending.length !== uploads.length) {
    throw new Error(
      `composeAttachmentMessage: pending.length (${pending.length}) does not match uploads.length (${uploads.length}) — upload pipeline must keep the two arrays parallel`,
    );
  }

  const images: PromptImage[] = [];
  const pathLines: string[] = [];

  for (let i = 0; i < pending.length; i += 1) {
    const attachment = pending[i];
    const upload = uploads[i];
    // Channel decision is shared with the server (extension-based) but the
    // server's view is authoritative when it disagrees with the client: if
    // the upload record carries base64 `data` the file was processed through
    // the image channel, regardless of how `file.type` classified it. This
    // rescues `.png` files whose `file.type` was empty or `octet-stream` —
    // they would otherwise be composed as `@path` and the model would never
    // see the image.
    const isImage = (typeof upload.data === "string" && upload.data.length > 0)
      || isImageExtension(attachment.file.name);
    if (isImage) {
      // Image-channel: base64 only, no path in text (ADR 0004).
      // An image record without base64 data is a server-side encoding
      // failure or a record returned with a mismatched channel — drop it
      // rather than emit a half-formed block. The upload pipeline surfaces
      // the underlying error before we get here in the common case (whole
      // batch fails), so this branch only fires when the server returns a
      // partial payload.
      if (upload.data && upload.mimeType) {
        images.push({
          type: "image",
          data: upload.data,
          mimeType: upload.mimeType,
        });
      }
    } else {
      // Path-channel: one @path line per file, in attachment order.
      pathLines.push(`@${upload.path}`);
    }
  }

  let message = userText;
  if (pathLines.length > 0) {
    const block = pathLines.join("\n");
    // No leading newline when the user wrote no text — keeps the
    // message body minimal for the common "user only attached files"
    // case.
    message = message.length === 0 ? block : `${message}\n${block}`;
  }

  return { message, images };
}
