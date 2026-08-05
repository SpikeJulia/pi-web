# Unified open entry: folder browser, right-click menu, and in-panel link previews

Pi Web's file model today is strictly "open a file in a right-panel tab". Folders
only expand in the Explorer tree, URLs in chat open in a new browser tab, and the
Explorer has no context menu. We are extending the open model so folders and URLs
are first-class previewable objects, and so every "open" gesture funnels through
one entry point.

## Decisions

### 1. Tab model gains a kind: `file | folder | url`

`TabBar.Tab` currently carries `filePath` + optional `sourceSessionId`. We extend
it (without breaking existing file tabs) with:

```ts
export interface Tab {
  id: string;
  label: string;
  filePath: string;        // for file & folder tabs
  sourceSessionId?: string | null;
  kind?: "file" | "folder" | "url";  // default "file"
  url?: string;            // for url tabs
}
```

Tab id stays `file:<path>` for files, `folder:<path>` for folders (so a path
that exists only as one kind cannot collide with itself), and
`url:<normalized>` for URLs, so existing file-tab dedup semantics
(AppShell.handleOpenFile) keep working.

### 2. One unified open handler in AppShell

New `handleOpenPath(filePath, sourceSessionId?)` decides the tab kind by asking
the server for the path type:

- `GET /api/files/<path>?type=meta` is extended to answer for directories too:
  it now returns `{ isDir: true }` instead of 400 when the path is a directory.
  This is the minimal server change; clients already trust this endpoint for
  size/language.

- If `isDir` → open a **folder tab** (right-panel folder browser).
- Else → open a **file tab** (existing FileViewer behavior).

New `handleOpenUrl(url)` opens a **url tab**: `id = url:<normalized>` where the
normalized url strips trailing slash and lowercases scheme/host for dedup.

Existing `handleOpenFile` is kept as the fast path for known-files (Explorer
file click, attachment chips) and delegates to `handleOpenPath` when the caller
does not already know the type. Explorer's folder click still expands the tree
(unchanged); the context-menu "Open" and chat link clicks use `handleOpenPath`.

### 3. FileViewer branches on kind

`FileViewer` gains `kind` + `url` props. Current dispatch (image/audio/document/
text) stays for `kind === "file"`. New branches:

- `kind === "folder"` → `FolderViewer`: fetches `type=list` for the directory,
  renders a simple name+icon list (folder icon / `getFileIcon`), double-click /
  single click on a file calls `onOpenFile` (opens a file tab), single click on a
  subdirectory navigates the folder browser into it (breadcrumb + up button back).
  Only name + icon, no size/mtime/git columns.
- `kind === "url"` → `UrlViewer`: embeds the URL in a sandboxed `<iframe>` and
  always shows an "Open in browser" button (`window.open(url, "_blank")`).
  Because browsers cannot detect X-Frame-Options denial reliably, the iframe may
  render blank for refusing sites; the button is the fallback. This is the
  agreed "C" behavior.

### 4. Explorer context menu

`FileExplorer` gains an internal context-menu state (position + target node),
opened via `onContextMenu` on each tree row (preventDefault). Items:

- **Folder**: "Open" (→ `handleOpenPath`, opens folder tab in right panel) and
  "Show in system file manager" (→ new API).
- **File**: "Open" (→ `handleOpenFile`/`handleOpenPath`) and
  "Show in system file manager" (→ new API). Existing hover download stays.

The menu is a small absolutely-positioned popover; clicking elsewhere or
pressing Escape closes it. Explorer already receives `onOpenFile`; we add
`onOpenPath` and `onOpenInSystem` props (SessionSidebar passes them through from
AppShell).

### 5. System file manager opening: server-controlled endpoint

New API `POST /api/system/open` with `{ path }`:

- Reuses the same authorization gate as `/api/files`: `getAllowedFileRoots()` +
  `isFilePathAllowed()`. Returns 403 for anything outside allowed roots.
- Runs the platform opener, never a shell string:
  - Windows: `explorer.exe /select,<path>` for files, `explorer.exe <path>` for dirs
  - macOS: `open -R <path>` (file) / `open <path>` (dir)
  - Linux: `xdg-open <parent>` (file) / `xdg-open <path>` (dir)
- Returns `{ ok: true }` or `{ ok: false, error }`.

This keeps the browser from ever seeing arbitrary shell access; the endpoint
only reveals "a path within allowed roots was opened by the OS".

### 6. Chat link clicks: local file/folder and URL split

`MarkdownBody` `a` renderer currently resolves local paths via
`resolveLocalFileHref` and opens them; everything else renders a plain link.
New behavior with `onOpenPath` + `onOpenUrl` props:

- Resolved local path → `onOpenPath(filePath)` (server decides file vs folder tab).
- `http(s)`/other external URL → `onOpenUrl(url)` → right-panel URL tab.
- Ctrl/Cmd-click, middle-click, or non-left click still falls through to the
  browser default (new tab), unchanged.

`FileViewer`'s markdown preview uses the same handler shape for its internal
links (it already resolves against `markdownDirectory`).

The `onOpenFile` prop chain (AppShell → ChatWindow → MessageView → MarkdownBody)
is replaced/augmented by `onOpenPath` + `onOpenUrl`; attachment chips keep using
`onOpenFile` for known files.

## Files touched

- `components/TabBar.tsx` — Tab type + folder/url tab icon handling
- `components/AppShell.tsx` — `handleOpenPath`, `handleOpenUrl`, right-panel kind dispatch, pass new props
- `components/FileViewer.tsx` — kind/url props, `FolderViewer`, `UrlViewer`
- `components/FileExplorer.tsx` — context menu, `onOpenPath`/`onOpenInSystem` props
- `components/SessionSidebar.tsx` — pass-through props
- `components/MarkdownBody.tsx` — link routing to `onOpenPath`/`onOpenUrl`
- `app/api/files/[...path]/route.ts` — meta returns `{ isDir }` for directories
- `app/api/system/open/route.ts` — new server-controlled system opener
- `lib/file-links.ts` — helpers for URL classification/normalization (pure, testable)
- tests: `lib/file-links.test.mjs` additions for URL classification; `app/api/files` behavior

## Non-goals

- No OS-native directory tree in the right panel beyond the name+icon list.
- No drag-and-drop of folders into tabs.
- Mobile long-press context menu is out of scope (desktop right-click only).
