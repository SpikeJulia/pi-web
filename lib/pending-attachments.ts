// Shared types and pure helpers for the chat input's attachment UI.
//
// Attachments are held client-side as `File` objects until ticket 04 wires
// upload on send. This module owns the shape that ticket 04 will consume, the
// per-message cap (10), and pure helpers for adding/removing entries from the
// list. It must stay DOM-only at the edges (preview URLs, file MIME checks)
// but pure everywhere else so it can be tested without a browser.

import { isImageExtension } from "./file-upload-policy";

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export interface PendingAttachment {
  /** Client-generated id; stable across renders. */
  id: string;
  /** Original File object — never leaves the browser until send (ticket 04). */
  file: File;
  /** object URL for image thumbnails; "" for non-image files. */
  previewUrl: string;
  status: "ready" | "error";
  /** Set when status === "error"; surfaces the rejection reason. */
  error?: string;
}

export interface AddFilesResult {
  /** Pending list after the add (unchanged when everything was rejected). */
  pending: PendingAttachment[];
  /** How many files were rejected (e.g. would push past the per-message cap). */
  rejected: number;
  /** Reason text for the rejection, suitable for a notice/toast. */
  rejectedReason?: string;
}

/**
 * Decide whether a file is "image-like". The channel decision must match
 * the server's `validateFilePolicy` (`lib/file-upload-policy.ts`), which
 * uses the extension as the authoritative signal because browser
 * uploaders often omit or mis-report `file.type` (a Windows file manager
 * drag of `shot.png` may produce `application/octet-stream`, and a paste
 * from the clipboard may produce an empty string). Sharing the helper
 * keeps client + server on the same extension list without duplicating
 * the set.
 */
export function isImageFile(file: File): boolean {
  return isImageExtension(file.name);
}

/**
 * Format a byte count for chip display. Mirrors typical file-manager units:
 * bytes (<1KB), KB (1KB–1MB), MB (≥1MB). Always 1–2 significant digits so
 * the chip width stays predictable next to the file name.
 */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  // Keep one decimal up to 99.9 KB so chips read precisely (e.g. "12.1 KB"
  // instead of "12 KB") without the width blowing up for huge files.
  if (kb < 100) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}

let lastId = 0;
function nextAttachmentId(): string {
  // Deterministic in test environments (Math.random mocked), monotonically
  // increasing within a session. Avoids crypto.randomUUID so server / SSR
  // code paths can import this module without polyfills.
  lastId += 1;
  return `att-${Date.now().toString(36)}-${lastId.toString(36)}`;
}

/**
 * Build a PendingAttachment from a raw File. Allocates an object URL for image
 * files so the chip can render a thumbnail; non-image files get an empty
 * previewUrl string. The caller owns the returned object and must revoke
 * `previewUrl` when the attachment leaves the list.
 */
export function createPendingAttachment(file: File): PendingAttachment {
  return {
    id: nextAttachmentId(),
    file,
    previewUrl: isImageFile(file) ? URL.createObjectURL(file) : "",
    status: "ready",
  };
}

/**
 * Revoke any object URL the attachment owns. Safe to call on a non-image
 * attachment (previewUrl is "") and on an already-revoked URL (browsers throw
 * a benign warning but no error).
 */
export function revokePendingAttachment(attachment: PendingAttachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

/**
 * Add incoming files to the pending list, enforcing the per-message cap.
 * Returns the new list and a count of any rejected files. When the cap would
 * be exceeded we keep the first `MAX_ATTACHMENTS_PER_MESSAGE` files and drop
 * the rest — duplicate original names are preserved as separate chips.
 */
export function addPendingAttachments(
  current: PendingAttachment[],
  incoming: File[],
): AddFilesResult {
  if (incoming.length === 0) return { pending: current, rejected: 0 };

  const remainingSlots = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - current.length);
  if (remainingSlots === 0) {
    return {
      pending: current,
      rejected: incoming.length,
      rejectedReason: rejectionMessage(incoming.length),
    };
  }

  const accepted = incoming.slice(0, remainingSlots).map(createPendingAttachment);
  const dropped = incoming.length - accepted.length;
  const pending = [...current, ...accepted];
  if (dropped === 0) return { pending, rejected: 0 };
  return {
    pending,
    rejected: dropped,
    rejectedReason: rejectionMessage(dropped),
  };
}

function rejectionMessage(rejectedCount: number): string {
  if (rejectedCount === 1) {
    return `You can attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message. That file was not added.`;
  }
  return `You can attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message. ${rejectedCount} extra files were not added.`;
}

/**
 * Remove an attachment by id. Does not mutate the input array. The caller is
 * responsible for revoking the removed attachment's previewUrl.
 */
export function removePendingAttachment(
  current: PendingAttachment[],
  id: string,
): PendingAttachment[] {
  return current.filter((a) => a.id !== id);
}

/**
 * Revoke every previewUrl in the list and return a fresh empty list.
 * Useful when the input is cleared or a draft is discarded.
 */
export function clearPendingAttachments(current: PendingAttachment[]): PendingAttachment[] {
  for (const attachment of current) revokePendingAttachment(attachment);
  return [];
}