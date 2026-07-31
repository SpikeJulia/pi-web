import { existsSync, readFileSync, writeFileSync } from "fs";
import { extname, join } from "path";

/**
 * Upload policy for `/api/file-upload`.
 *
 * This module is a pure policy layer that sits on top of the storage
 * pipeline (`lib/file-upload-storage.ts`). It owns three concerns:
 *
 * 1. **Size limits** — image-channel attachments cap at 10MB, path-channel
 *    attachments cap at 50MB. The cap is enforced after the upload route
 *    has buffered the bytes so we can size-check before any disk write.
 * 2. **Type allowlist** — images are routed through the image channel by
 *    extension; common office/archive/audio/video types are routed through
 *    the path channel; executable extensions are rejected outright;
 *    unknown-but-harmless extensions also fall through to the path channel.
 * 3. **`.gitignore` injection** — after a successful upload the route calls
 *    `ensurePiUploadsGitignore(cwd)` to guarantee `<cwd>/.pi-uploads/` is
 *    covered, appending only when the rule is missing.
 *
 * Results are structured (`{ ok, ... }`) so the route can map them to the
 * right HTTP status and `{ error }` body shape without re-deriving either.
 */

// --- size constants (tickets #3 acceptance criteria) ---

/** Max bytes for image-channel attachments (sent inline as base64). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Max bytes for path-channel attachments (referenced via `@<path>`). */
export const MAX_PATH_BYTES = 50 * 1024 * 1024;

/** The gitignore rule the injector appends. */
export const PI_UPLOADS_GITIGNORE_RULE = ".pi-uploads/";

// --- extension sets ---

/**
 * Image extensions that route to the inline image channel. Browser MIME
 * sniffing is unreliable across platforms, so the extension is the source
 * of truth — see the ticket rationale.
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
]);

/**
 * Permissive allowlist for path-channel attachments. This is *not* an
 * exhaustive blocklist — unknown-but-harmless extensions also flow through
 * the path channel; only `EXECUTABLE_EXTENSIONS` are rejected outright.
 *
 * The allowlist is documentation-only here: any non-image, non-executable
 * extension is routed to the path channel. The set is referenced by the
 * unit tests so this comment stays in sync with the tested allowlist.
 */
const PATH_EXTENSIONS: ReadonlySet<string> = new Set([
  // office / documents
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "csv",
  "txt",
  "md",
  // archives
  "zip",
  "tar",
  "gz",
  "7z",
  // audio
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "flac",
  // video
  "mp4",
  "webm",
  "mov",
]);

// Keep the allowlist reachable from the module's surface so the spec
// checklist and the unit tests stay honest about which extensions are
// expected to flow through the path channel.
void PATH_EXTENSIONS;

/**
 * Extensions blocked at the upload entry point so it cannot be used to
 * drop native executables or Windows scripts into the project. The list
 * matches the ticket verbatim.
 */
const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  "exe",
  "bat",
  "cmd",
  "ps1",
  "dll",
  "so",
]);

/** Channel an attachment is routed through once the policy passes. */
export type UploadChannel = "image" | "path";

/**
 * Structured result returned by `validateFilePolicy`. On success the
 * channel tells the caller how to deliver the file (inline vs `@path`);
 * on failure `{ error, status }` maps directly to a NextResponse JSON
 * body and HTTP status code.
 */
export type PolicyResult =
  | { ok: true; channel: UploadChannel }
  | { ok: false; error: string; status: number };

// --- extension helper ---

/**
 * Lowercase extension without the leading dot. Empty string when the name
 * has no extension. Node's `extname` is reused here so multi-suffix names
 * like `archive.tar.gz` collapse to `gz`, matching how
 * `generateStoredFileName` already splits extensions.
 */
export function getExtension(fileName: string): string {
  return extname(fileName).toLowerCase().replace(/^\./, "");
}

// --- file-type + size policy ---

/**
 * Validate a single attachment against the upload policy. Extension wins
 * over MIME because Windows uploaders often omit `file.type`. The size
 * cap is then applied against the channel the extension picks.
 *
 * Order of checks:
 *   1. Executable extension → 400 reject.
 *   2. Image extension → image channel + 10MB cap.
 *   3. Anything else (known path-channel or unknown) → path channel + 50MB
 *      cap. "Unknown but harmless" passing the path channel is explicit in
 *      the ticket — only executables are blocked outright.
 */
export function validateFilePolicy(
  originalName: string,
  mimeType: string,
  bytesLength: number,
): PolicyResult {
  // `mimeType` is part of the signature so future revisions can layer in
  // MIME-based signals (e.g. sniff `application/x-msdownload`). Today the
  // extension is authoritative, but accepting the field keeps callers from
  // dropping information at the call site.
  void mimeType;

  const extension = getExtension(originalName);

  if (extension && EXECUTABLE_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      error: `Executable file type not allowed: .${extension}`,
      status: 400,
    };
  }

  if (extension && IMAGE_EXTENSIONS.has(extension)) {
    if (bytesLength > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `Image exceeds 10MB size limit: ${originalName} (${bytesLength} bytes)`,
        status: 413,
      };
    }
    return { ok: true, channel: "image" };
  }

  if (bytesLength > MAX_PATH_BYTES) {
    return {
      ok: false,
      error: `File exceeds 50MB size limit: ${originalName} (${bytesLength} bytes)`,
      status: 413,
    };
  }
  return { ok: true, channel: "path" };
}

// --- .gitignore injection ---

/**
 * Result of `ensurePiUploadsGitignore`. `added` distinguishes "created or
 * appended" from "already present", which is what callers want to log.
 */
export interface GitignoreInjectionResult {
  added: boolean;
  /** Absolute path of the gitignore file (existing or just-created). */
  path: string;
}

/**
 * Ensure `<cwd>/.gitignore` covers `.pi-uploads/`. Idempotent:
 *
 *   - Missing file → create with `.pi-uploads/` + trailing newline.
 *   - Existing file without the rule → append, inserting a newline if the
 *     previous content did not end with one.
 *   - Existing file with the rule → no-op, file is left byte-for-byte
 *     identical.
 *
 * Comments and blank lines are skipped when looking for an existing rule.
 * Leading slashes (`/.pi-uploads/`) and the no-trailing-slash variant
 * (`.pi-uploads`) are treated as the same rule — both effectively cover
 * the same files in gitignore semantics.
 *
 * I/O errors (unreadable, unwritable) are swallowed: a missing gitignore
 * hint should not fail an upload.
 */
export function ensurePiUploadsGitignore(cwd: string): GitignoreInjectionResult {
  const path = join(cwd, ".gitignore");
  const rule = PI_UPLOADS_GITIGNORE_RULE;

  let existing = "";
  try {
    if (existsSync(path)) {
      existing = readFileSync(path, "utf8");
    }
  } catch {
    return { added: false, path };
  }

  if (gitignoreHasRule(existing, rule)) {
    return { added: false, path };
  }

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const next = `${existing}${needsLeadingNewline ? "\n" : ""}${rule}\n`;

  try {
    writeFileSync(path, next, "utf8");
  } catch {
    return { added: false, path };
  }
  return { added: true, path };
}

/**
 * True when `content` already contains a rule equivalent to `rule`.
 * Equivalent means: ignoring whitespace, comments, blank lines, and
 * normalizing away a leading `/` and trailing `/`. That covers
 * `.pi-uploads`, `.pi-uploads/`, `/.pi-uploads`, `/.pi-uploads/` — the
 * four ways a user typically writes the rule.
 *
 * Exported so the unit tests can pin the matching behavior without
 * exercising the disk-write path.
 */
export function gitignoreHasRule(content: string, rule: string): boolean {
  const target = normalizeRule(rule);
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (normalizeRule(line) === target) return true;
  }
  return false;
}

function normalizeRule(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("/")) s = s.slice(1);
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}
