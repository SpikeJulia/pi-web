import { randomBytes } from "crypto";
import { extname, join } from "path";

/**
 * Validate a single attachment's original filename. Mirrors the file-upload
 * pipeline's `validateUploadFileNames` rejection of empty names, dot/dotdot,
 * NUL bytes, and path segments, but allows duplicate names within a single
 * request because the chat-attachment UX treats each file as independent.
 *
 * Returns null on success, or a human-readable error message on failure.
 */
export function validateAttachmentFileName(fileName: string): string | null {
  if (!fileName || fileName === "." || fileName === ".." || fileName.includes("\0")) {
    return `Invalid file name: ${fileName || "(empty)"}`;
  }
  if (fileName.includes("/") || fileName.includes("\\")) {
    return `File names must not contain a path: ${fileName}`;
  }
  return null;
}

/**
 * Generate an opaque stored filename: 16 lowercase hex chars (8 random bytes)
 * plus the original extension, lowercased. Files without an extension get
 * only the random prefix. The original name is never used on disk, per
 * ADR 0001.
 */
export function generateStoredFileName(originalName: string): string {
  const ext = extname(originalName).toLowerCase();
  return `${randomBytes(8).toString("hex")}${ext}`;
}

/**
 * Compose the posix-style relative path returned to the client:
 * `.pi-uploads/<sessionId>/<storedName>`. The relative form lets the client
 * drop the cwd and still produce a path the agent can resolve with `@`.
 */
export function getRelativeUploadPath(sessionId: string, storedName: string): string {
  return `.pi-uploads/${sessionId}/${storedName}`;
}

/**
 * Resolve the absolute on-disk upload directory for a (cwd, sessionId) pair.
 * The `.pi-uploads/<sessionId>/` layout is the per-session storage boundary
 * decided in ADR 0001; cleanup is a directory delete.
 */
export function getUploadDirectory(cwd: string, sessionId: string): string {
  return join(cwd, ".pi-uploads", sessionId);
}

/**
 * True when a MIME type identifies the part as an image and therefore the
 * server should base64-encode the bytes for inline delivery to the agent.
 */
export function isImageMimeType(mimeType: string): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}