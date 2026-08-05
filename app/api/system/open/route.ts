import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";

// Reject cross-site POSTs (CSRF). This endpoint has an OS side effect
// (opens a file-manager window), so it must not be triggerable from a
// third-party page via a form/`text/plain` request.
function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin header: same-origin navigation / non-browser client. Allow,
    // matching the repo's other API routes which rely on the allowed-roots gate.
    return true;
  }
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    return originUrl.protocol === requestUrl.protocol
      && originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as { path?: unknown } | null;
    const targetPath = typeof body?.path === "string" ? body.path.trim() : "";
    if (!targetPath) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(targetPath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(targetPath);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isDir = stat.isDirectory();
    const platform = process.platform;
    let command: string;
    let args: string[];

    if (platform === "win32") {
      command = "explorer.exe";
      // `/select,` must be joined to the path in a single argument
      // (e.g. `/select,C:\Users\me\file.txt`), not passed separately.
      args = isDir ? [targetPath] : [`/select,${targetPath}`];
    } else if (platform === "darwin") {
      command = "open";
      args = isDir ? [targetPath] : ["-R", targetPath];
    } else {
      command = "xdg-open";
      args = isDir ? [targetPath] : [path.dirname(targetPath)];
    }

    // `spawn` failure is asynchronous (an 'error' event), so resolve the
    // response from the event handlers instead of checking a flag afterwards.
    return new Promise<Response>((resolve) => {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.once("error", (error) => {
        resolve(NextResponse.json(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        ));
      });
      child.once("spawn", () => {
        child.unref();
        resolve(NextResponse.json({ ok: true }));
      });
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}