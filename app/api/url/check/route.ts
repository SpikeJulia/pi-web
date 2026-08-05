import { NextRequest, NextResponse } from "next/server";
import { urlForbidsEmbedding } from "@/lib/url-embed";

const CHECK_TIMEOUT_MS = 8_000;

/**
 * Checks whether a target URL may be embedded in the right-panel iframe by
 * inspecting its X-Frame-Options / CSP frame-ancestors response headers.
 * Browsers cannot detect iframe refusal from the parent page, so this server
 * probe is the source of truth for the "Open in browser" hint.
 */
export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "only http(s) urls are supported" }, { status: 400 });
  }

  const ourOrigin = new URL(request.url).origin;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Behave like a browser so the target returns its real page headers.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    // Headers only; abort the body so the probe does not download the page.
    await response.body?.cancel().catch(() => {});

    const xFrameOptions = response.headers.get("x-frame-options");
    const contentSecurityPolicy = response.headers.get("content-security-policy");
    return NextResponse.json({
      embeddable: !urlForbidsEmbedding(
        { "x-frame-options": xFrameOptions, "content-security-policy": contentSecurityPolicy },
        ourOrigin,
      ),
      xFrameOptions,
      contentSecurityPolicy,
    });
  } catch {
    // Timeout / network failure: we cannot prove refusal. Fall back to
    // optimistic embeddable so the user still sees the iframe attempt and
    // the always-present Open-in-browser button.
    return NextResponse.json({ embeddable: true, error: "probe failed" });
  } finally {
    clearTimeout(timer);
  }
}
