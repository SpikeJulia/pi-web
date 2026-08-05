/**
 * Pure helpers for deciding whether a URL may be embedded in the right-panel
 * iframe. Browsers cannot detect an iframe refusal (X-Frame-Options / CSP
 * frame-ancestors) from inside the parent page, so the server checks the
 * target's response headers before we render the iframe.
 */

const FRAME_ANCESTORS_RE = /frame-ancestors\s+([^;]*)/i;

/**
 * True when an X-Frame-Options header forbids framing from our origin.
 * - `DENY` forbids everyone.
 * - `SAMEORIGIN` forbids any other origin (we preview cross-origin pages, so
 *   same-origin targets are effectively never the case we render).
 */
export function xFrameOptionsForbids(xFrameOptions: string | null | undefined): boolean {
  if (!xFrameOptions) return false;
  const value = xFrameOptions.trim().toUpperCase();
  if (value === "DENY") return true;
  if (value === "SAMEORIGIN") return true;
  // `ALLOW-FROM <uri>` is obsolete; treat as not-forbidding (best effort).
  return false;
}

/**
 * True when a Content-Security-Policy header's `frame-ancestors` directive
 * forbids framing from `ourOrigin`. When the directive is absent, CSP does
 * not restrict framing. `'self'` refers to the framed document's own origin,
 * never our preview origin, so it is treated as forbidding.
 */
export function cspForbidsFraming(
  contentSecurityPolicy: string | null | undefined,
  ourOrigin: string,
): boolean {
  if (!contentSecurityPolicy) return false;
  const match = FRAME_ANCESTORS_RE.exec(contentSecurityPolicy);
  if (!match) return false;
  const value = match[1].trim();
  if (!value) return true;
  if (value.includes("'none'")) return true;
  if (value.includes("'self'")) return true;
  const origins = value.split(/\s+/).filter(Boolean);
  return !origins.includes(ourOrigin);
}

/**
 * Combined check: does this target URL's response forbid iframe embedding
 * from our origin?
 */
export function urlForbidsEmbedding(
  headers: { "x-frame-options"?: string | null; "content-security-policy"?: string | null },
  ourOrigin: string,
): boolean {
  return xFrameOptionsForbids(headers["x-frame-options"])
    || cspForbidsFraming(headers["content-security-policy"], ourOrigin);
}
