import { NextResponse } from "next/server";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { authorizeCwd } from "@/lib/file-access";
import {
  ensurePiUploadsGitignore,
  validateFilePolicy,
} from "@/lib/file-upload-policy";
import {
  generateStoredFileName,
  getRelativeUploadPath,
  getUploadDirectory,
  isImageMimeType,
  validateAttachmentFileName,
} from "@/lib/file-upload-storage";

export const dynamic = "force-dynamic";

export interface FileUploadRecord {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  data: string | null;
}

interface PersistResult {
  record: FileUploadRecord;
  bytes: Buffer;
  storedPath: string;
  sidecarPath: string;
}

/**
 * Write the uploaded bytes and sidecar metadata to disk under the
 * per-session upload directory. Returns the public upload record alongside
 * the raw bytes plus the absolute paths the caller needs to roll back on a
 * later write failure.
 */
function persistUpload(
  cwd: string,
  sessionId: string,
  originalName: string,
  mimeType: string,
  bytes: Buffer,
  now: Date,
): PersistResult {
  const uploadDir = getUploadDirectory(cwd, sessionId);
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  const storedName = generateStoredFileName(originalName);
  const storedPath = `${uploadDir}/${storedName}`;
  const sidecarPath = `${storedPath}.meta.json`;

  writeFileSync(storedPath, bytes);
  writeFileSync(
    sidecarPath,
    JSON.stringify(
      {
        originalName,
        mimeType,
        size: bytes.length,
        uploadedAt: now.toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  return {
    record: {
      name: originalName,
      path: getRelativeUploadPath(sessionId, storedName),
      mimeType,
      size: bytes.length,
      data: null,
    },
    bytes,
    storedPath,
    sidecarPath,
  };
}

/**
 * Encode an image payload as a base64 string with no data URL prefix, or
 * return null for non-image parts. The pipeline never wraps the payload so
 * the client controls the prefix when assembling the agent prompt.
 */
function encodeImageData(mimeType: string, bytes: Buffer): string | null {
  if (!isImageMimeType(mimeType)) return null;
  return bytes.toString("base64");
}

/**
 * Best-effort rollback for a partial multi-file write. Silently swallows
 * per-path errors — the caller is already in an error branch and the goal
 * is to leave the directory as empty as possible rather than to chase the
 * last byte.
 *
 * Exported as `__rollbackWrittenFiles` for unit testing the cleanup
 * contract directly; production callers should not reach for it.
 */
export function __rollbackWrittenFiles(
  written: Array<{ storedPath: string; sidecarPath: string }>,
): void {
  for (const { storedPath, sidecarPath } of written) {
    try {
      rmSync(storedPath, { force: true });
    } catch {
      // ignore — best-effort cleanup
    }
    try {
      rmSync(sidecarPath, { force: true });
    } catch {
      // ignore — best-effort cleanup
    }
  }
}

/**
 * POST /api/file-upload  multipart/form-data with fields:
 *   - cwd       (absolute project path)
 *   - sessionId (uuid of the active pi session)
 *   - file      (one or more uploaded files)
 *
 * Stores each file under <cwd>/.pi-uploads/<sessionId>/<random-hex><.ext>
 * alongside a sidecar `.meta.json` carrying the original name, MIME type,
 * size, and upload timestamp. The original filename is never written to
 * disk. Returns `{ files: [{ name, path, mimeType, size, data }] }` where
 * `data` is base64 for image parts and null otherwise.
 *
 * Policy (ticket #3) is enforced before any disk write:
 *   1. Every file's bytes are buffered and checked for name validity, size
 *      cap (10MB image / 50MB path), and type allowlist. Any failure
 *      rejects the whole batch with `{ error }` and the right status code.
 *   2. Files are persisted only after preflight passes for every file. If
 *      a later write throws, the route deletes the files it already wrote
 *      so the on-disk state never holds a partial batch.
 *   3. After every file persists successfully, `<cwd>/.gitignore` is
 *      checked and `.pi-uploads/` is appended when missing.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        { error: "request body must be multipart/form-data" },
        { status: 400 },
      );
    }

    const cwd = typeof form.get("cwd") === "string" ? (form.get("cwd") as string).trim() : "";
    const sessionId =
      typeof form.get("sessionId") === "string" ? (form.get("sessionId") as string).trim() : "";

    const denied = await authorizeCwd(cwd);
    if (denied) return denied;

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    // Reject path traversal in the sessionId field. `getUploadDirectory`
    // joins it with `<cwd>/.pi-uploads/` directly, so a value like
    // `../../x` would write outside the per-session storage boundary. The
    // cleanup route uses the same validator so the rules stay aligned.
    const sessionIdError = validateAttachmentFileName(sessionId);
    if (sessionIdError) {
      return NextResponse.json(
        {
          error: `sessionId ${sessionIdError.replace(/^.*?: /, "must be valid: ")}`,
        },
        { status: 400 },
      );
    }

    const entries = form.getAll("file");
    const files = entries.filter((entry): entry is File => typeof entry !== "string");
    if (files.length === 0) {
      return NextResponse.json(
        { error: "at least one file part is required" },
        { status: 400 },
      );
    }

    const now = new Date();

    // Preflight: read every file's bytes first, validate name + size + type,
    // and only persist after all checks pass. Preflight failures short-
    // circuit without touching the disk.
    type Prepared = { file: File; bytes: Buffer };
    const prepared: Prepared[] = [];
    for (const file of files) {
      const originalName = file.name ?? "";
      const validationError = validateAttachmentFileName(originalName);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const policy = validateFilePolicy(originalName, bytes.length);
      if (!policy.ok) {
        return NextResponse.json({ error: policy.error }, { status: policy.status });
      }
      prepared.push({ file, bytes });
    }

    // Persistence pass. Track every successful (storedPath, sidecarPath)
    // pair so a later write failure can roll back the partial batch.
    const records: FileUploadRecord[] = [];
    const written: Array<{ storedPath: string; sidecarPath: string }> = [];
    try {
      for (const { file, bytes } of prepared) {
        const originalName = file.name ?? "";
        const mimeType = file.type || "application/octet-stream";
        const { record, storedPath, sidecarPath } = persistUpload(
          cwd,
          sessionId,
          originalName,
          mimeType,
          bytes,
          now,
        );
        written.push({ storedPath, sidecarPath });
        record.data = encodeImageData(mimeType, bytes);
        records.push(record);
      }
    } catch (error) {
      __rollbackWrittenFiles(written);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }

    // After every file lands on disk, ensure .pi-uploads/ is git-ignored.
    // The injector is best-effort — a write failure here does not poison
    // the upload result.
    ensurePiUploadsGitignore(cwd);

    return NextResponse.json({ files: records });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
