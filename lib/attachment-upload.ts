// Client-side helper that uploads pending attachments to the server.
//
// Ticket 04. Wraps `POST /api/file-upload` so the send-flow code in
// `useAgentSession.handleSend` can stay focused on orchestration: build
// the FormData, await the response, and surface the result as a tagged
// union (`ok: true` with parsed records, or `ok: false` with the
// server-provided error message).
//
// The upload endpoint is synchronous: it returns 200 with the list of
// stored records on success, or 4xx/5xx with `{ error: string }` on
// validation, authorization, or per-file failures. Network errors and
// malformed JSON bodies are folded into `{ ok: false }` so callers never
// need a try/catch.

import type { UploadRecord } from "./attachment-message";

export type UploadAttachmentsResult =
  | { ok: true; files: UploadRecord[] }
  | { ok: false; error: string };

/**
 * POST the provided files to `/api/file-upload` as multipart/form-data,
 * along with the `cwd` and `sessionId` fields the route requires for the
 * per-session storage layout (`<cwd>/.pi-uploads/<sessionId>/`).
 *
 * Returns a tagged union. Successful uploads resolve with the parsed
 * list of `UploadRecord`s (image records carry base64 in `data`, path
 * records have `data: null`). Any failure — network error, non-2xx HTTP
 * status, malformed JSON, or unexpected response shape — resolves with
 * `{ ok: false, error: <human-readable message> }`. The error string is
 * what the chat input shows to the user and what the chip-error banner
 * surfaces.
 */
export async function uploadAttachments(
  cwd: string,
  sessionId: string,
  files: File[],
): Promise<UploadAttachmentsResult> {
  if (files.length === 0) {
    return { ok: false, error: "No attachments to upload" };
  }
  if (!cwd) {
    return { ok: false, error: "Project path is not set — cannot upload attachments" };
  }
  if (!sessionId) {
    return { ok: false, error: "Session is not ready — cannot upload attachments" };
  }

  const form = new FormData();
  form.append("cwd", cwd);
  form.append("sessionId", sessionId);
  for (const file of files) form.append("file", file);

  let res: Response;
  try {
    res = await fetch("/api/file-upload", { method: "POST", body: form });
  } catch (networkError) {
    return {
      ok: false,
      error:
        networkError instanceof Error
          ? `Upload failed: ${networkError.message}`
          : "Upload failed: network error",
    };
  }

  // The route always returns JSON for 4xx/5xx; 2xx bodies are JSON too,
  // but tolerate a missing/malformed body defensively — the caller still
  // gets a clear error string instead of a thrown exception.
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const serverErrorMessage =
    body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : null;

  if (!res.ok) {
    return {
      ok: false,
      error: serverErrorMessage ?? `Upload failed (HTTP ${res.status})`,
    };
  }

  const records = parseUploadResponse(body);
  if (!records) {
    return { ok: false, error: serverErrorMessage ?? "Upload response was malformed" };
  }
  if (records.length !== files.length) {
    return {
      ok: false,
      error: `Upload server returned ${records.length} of ${files.length} records — partial upload, send aborted`,
    };
  }
  return { ok: true, files: records };
}

/**
 * Type-validate the JSON body the route returns. The shape is fixed
 * (`{ files: Array<{ name, path, mimeType, size, data }> }`), but a
 * future server migration or partial outage could return something
 * different; failing closed here keeps the send pipeline safe.
 */
function parseUploadResponse(body: unknown): UploadRecord[] | null {
  if (!body || typeof body !== "object") return null;
  const files = (body as { files?: unknown }).files;
  if (!Array.isArray(files)) return null;
  const records: UploadRecord[] = [];
  for (const item of files) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.name !== "string"
      || typeof candidate.path !== "string"
      || typeof candidate.mimeType !== "string"
      || typeof candidate.size !== "number"
    ) {
      return null;
    }
    records.push({
      name: candidate.name,
      path: candidate.path,
      mimeType: candidate.mimeType,
      size: candidate.size,
      data: typeof candidate.data === "string" ? candidate.data : null,
    });
  }
  return records;
}
