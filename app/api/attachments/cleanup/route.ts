import { NextResponse } from "next/server";
import { existsSync, readdirSync, rmSync } from "fs";
import { isAbsolute, join } from "path";
import {
  getAllowedFileRoots,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { validateAttachmentFileName } from "@/lib/file-upload-storage";

export const dynamic = "force-dynamic";

type CleanupScope = "session" | "project";

interface CleanupRequestBody {
  cwd?: unknown;
  scope?: unknown;
  sessionId?: unknown;
}

interface CleanupSuccessBody {
  ok: true;
  scope: CleanupScope;
  /** POSIX-style relative path of the removed directory, e.g. ".pi-uploads/<sessionId>". */
  path: string;
  /** Total number of entries removed (files + sidecars + sub-directories). */
  deletedCount: number;
  /** Echoed back when scope === "session" so the client can confirm. */
  sessionId?: string;
}

const PROJECT_UPLOAD_DIR = ".pi-uploads";

async function authorizeCwd(cwd: string): Promise<NextResponse | null> {
  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }
  if (!isAbsolute(cwd) && !isWindowsAbsolutePath(cwd)) {
    return NextResponse.json(
      { error: "cwd must be an absolute path" },
      { status: 400 },
    );
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

/**
 * Recursively count every entry (file or directory) reachable from `dir`.
 * The count is consumed by the response so the UI can show "Removed N
 * attachments" feedback. The upload layout is flat (each session owns a
 * directory of files + sidecar `.meta.json`), so traversal is shallow in
 * practice but we still walk the tree to be safe when the directory holds
 * nested sub-directories from other tooling.
 */
function countEntries(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    total += entries.length;
    for (const entry of entries) {
      stack.push(join(current, entry));
    }
  }
  return total;
}

/**
 * POST /api/attachments/cleanup  body: { cwd, scope, sessionId? }
 *
 * Removes attachment content from disk under `<cwd>/.pi-uploads/<sessionId>/`
 * (scope `session`) or `<cwd>/.pi-uploads/` (scope `project`). The deletion
 * only touches the off-limits storage directory — history `.jsonl` files
 * are never read or rewritten, so any chat reference to a removed attachment
 * simply resolves to nothing.
 *
 * Missing directories are a no-op (200 with `deletedCount: 0`). The handler
 * is the single source of truth for the path composition; the client only
 * renders the response body.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return NextResponse.json(
        { error: "request body must be a JSON object" },
        { status: 400 },
      );
    }
    const body = raw as CleanupRequestBody;
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

    const denied = await authorizeCwd(cwd);
    if (denied) return denied;

    if (body.scope !== "session" && body.scope !== "project") {
      return NextResponse.json(
        { error: "scope must be 'session' or 'project'" },
        { status: 400 },
      );
    }
    const scope = body.scope as CleanupScope;

    let absoluteDir: string;
    let displayPath: string;
    let sessionId: string | undefined;

    if (scope === "session") {
      const sessionIdRaw = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
      const nameError = validateAttachmentFileName(sessionIdRaw);
      if (nameError) {
        return NextResponse.json(
          { error: `sessionId ${nameError.replace(/^.*?: /, "must be valid: ")}` },
          { status: 400 },
        );
      }
      sessionId = sessionIdRaw;
      absoluteDir = join(cwd, PROJECT_UPLOAD_DIR, sessionId);
      displayPath = `${PROJECT_UPLOAD_DIR}/${sessionId}`;
    } else {
      absoluteDir = join(cwd, PROJECT_UPLOAD_DIR);
      displayPath = PROJECT_UPLOAD_DIR;
    }

    if (!existsSync(absoluteDir)) {
      const noop: CleanupSuccessBody = {
        ok: true,
        scope,
        path: displayPath,
        deletedCount: 0,
        ...(sessionId ? { sessionId } : {}),
      };
      return NextResponse.json(noop);
    }

    const deletedCount = countEntries(absoluteDir);
    rmSync(absoluteDir, { recursive: true, force: true });

    const success: CleanupSuccessBody = {
      ok: true,
      scope,
      path: displayPath,
      deletedCount,
      ...(sessionId ? { sessionId } : {}),
    };
    return NextResponse.json(success);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
