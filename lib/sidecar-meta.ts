/**
 * Sidecar-metadata fetcher for history rendering.
 *
 * Path-channel attachments are stored at
 *   <cwd>/.pi-uploads/<sessionId>/<storedName>
 * with a sidecar
 *   <cwd>/.pi-uploads/<sessionId>/<storedName>.meta.json
 * containing `{ originalName, mimeType, size, uploadedAt }`. Random
 * stored names are meaningless to humans, so chips need that sidecar to
 * show the original filename and size (ADR-0001).
 *
 * This module talks to the existing `/api/files` route (`type=read`) —
 * which already enforces the allowed-roots whitelist — to fetch the
 * sidecar JSON. A pluggable `SidecarFetcher` keeps the network call out
 * of the unit tests; the production default wraps `fetch()`.
 *
 * If the sidecar is missing (cleanup ran, or the message pre-dates the
 * attachment feature), the resolver degrades to `null` and the chip falls
 * back to showing the stored name. This is intentional — see the ticket's
 * "missing sidecar degrades to stored name" acceptance criterion.
 */

import { encodeFilePathForApi } from "./file-paths";

/**
 * Shape of a parsed sidecar. Mirrors the payload written by the file
 * upload route (see `app/api/file-upload/route.ts::persistUpload`).
 */
export interface SidecarMetadata {
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

/**
 * Minimal HTTP contract the resolver needs from its environment. The
 * default fetcher uses the global `fetch`, but tests can inject a stub.
 * The fetcher returns the parsed JSON response body or throws on a
 * non-2xx status — `null` here means "sidecar missing / unreadable".
 */
export type SidecarFetcher = (
  url: string,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Compose the URL the fetcher will call. Exposed so tests can assert the
 * exact URL without reaching into `fetchSidecarMeta`'s internals.
 */
export function getSidecarApiUrl(cwd: string, sessionId: string, storedName: string): string {
  // `encodeFilePathForApi` URL-encodes each segment and forces forward
  // slashes, which is what `/api/files/[...path]` expects.
  const sidecarPath = `${cwd}/.pi-uploads/${sessionId}/${storedName}.meta.json`;
  const encoded = encodeFilePathForApi(sidecarPath);
  return `/api/files/${encoded}?type=read`;
}

/**
 * Validate a parsed sidecar payload. Returns the typed metadata on
 * success or `null` when any required field is missing or wrong-typed.
 * We deliberately tolerate extra fields (forward-compat) but reject
 * silent schema drift on the four we depend on.
 */
export function parseSidecarPayload(payload: unknown): SidecarMetadata | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  const { originalName, mimeType, size, uploadedAt } = candidate;
  if (typeof originalName !== "string" || originalName.length === 0) return null;
  if (typeof mimeType !== "string" || mimeType.length === 0) return null;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  if (typeof uploadedAt !== "string") return null;
  return { originalName, mimeType, size, uploadedAt };
}

/**
 * Fetch and parse a sidecar. Returns `null` when:
 *   - the HTTP status is non-2xx (404 = sidecar deleted, 403 = gone),
 *   - the response body fails to parse as JSON,
 *   - the parsed JSON is missing required fields.
 *
 * Network errors throw — the caller decides whether to swallow them.
 */
export async function fetchSidecarMeta(
  cwd: string,
  sessionId: string,
  storedName: string,
  fetcher: SidecarFetcher = defaultSidecarFetcher,
): Promise<SidecarMetadata | null> {
  if (!cwd || !sessionId || !storedName) return null;
  const url = getSidecarApiUrl(cwd, sessionId, storedName);
  const response = await fetcher(url);
  if (!response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  return parseSidecarPayload(body);
}

/**
 * Default fetcher: thin wrapper over `fetch()`. Lives in its own
 * function so SSR/test environments that don't have `fetch` can stub it
 * via the `fetcher` parameter.
 */
export async function defaultSidecarFetcher(
  url: string,
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  if (typeof fetch !== "function") {
    throw new Error("fetch is not available in this environment");
  }
  const response = await fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json().catch(() => null),
  };
}

/**
 * Minimal cache so a long history of repeated messages referencing the
 * same attachments doesn't re-hit the sidecar endpoint for every chip.
 * Keys are absolute paths so different cwds / sessions stay isolated.
 *
 * The cache stores `Promise<SidecarMetadata | null>` so concurrent
 * callers share one in-flight request instead of stampeding the API.
 */
export class SidecarMetaCache {
  private readonly store = new Map<string, Promise<SidecarMetadata | null>>();
  private readonly fetcher: SidecarFetcher;

  constructor(fetcher: SidecarFetcher = defaultSidecarFetcher) {
    this.fetcher = fetcher;
  }

  /**
   * Resolve the sidecar for a given `(cwd, sessionId, storedName)` triple.
   * Identical keys return the same in-flight or settled promise, so two
   * chips for the same file resolve once.
   */
  resolve(cwd: string, sessionId: string, storedName: string): Promise<SidecarMetadata | null> {
    const key = `${cwd}::${sessionId}::${storedName}`;
    const existing = this.store.get(key);
    if (existing) return existing;
    const next = fetchSidecarMeta(cwd, sessionId, storedName, this.fetcher).catch(() => null);
    this.store.set(key, next);
    return next;
  }

  /**
   * Drop a single cached entry. The sidecar may have been rewritten by a
   * new upload, so chat actions that invalidate history should call this.
   */
  invalidate(cwd: string, sessionId: string, storedName: string): void {
    this.store.delete(`${cwd}::${sessionId}::${storedName}`);
  }

  /** Drop every cached entry. */
  clear(): void {
    this.store.clear();
  }
}

/**
 * Compose the absolute on-disk path to the stored file (no sidecar
 * suffix). This is what the FileViewer receives when a chip is clicked,
 * so the path points at the actual attachment rather than the metadata.
 */
export function getStoredFileAbsolutePath(cwd: string, sessionId: string, storedName: string): string {
  return `${cwd}/.pi-uploads/${sessionId}/${storedName}`;
}

/**
 * Compose the human-friendly fallback label used when the sidecar is
 * missing. Mirrors the displayed stored name (the random hex plus the
 * extension the server saw) so the chip is still identifiable.
 */
export function getFallbackDisplayName(storedName: string): string {
  return storedName;
}