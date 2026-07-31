"use client";

import { useState, useCallback, useRef } from "react";

/**
 * Generic drag-drop helper. Attach the returned handlers to any container
 * (the chat window mounts them on its outer div) and provide an `onDrop`
 * that receives every dropped `File`. The hook:
 *  - Tracks drag-over depth so nested child events don't flicker the highlight.
 *  - Prevents the browser's default file-open behavior (otherwise the page
 *    would navigate to the dropped file).
 *  - Accepts any file type — attachments are no longer image-only.
 *
 * The drop zone's scope is the container the handlers are attached to. The
 * file explorer / sidebar live outside the chat window's outer div, so they
 * are NOT drop zones by construction (no handler is attached to them).
 */
export function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    // Only react to file drags. Other drag sources (text selection inside the
    // chat, layout tiles, etc.) keep their default behavior.
    const hasFiles = Array.from(e.dataTransfer.types).includes("Files");
    if (!hasFiles) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasFiles = Array.from(e.dataTransfer.types).includes("Files");
    if (!hasFiles) return;
    e.preventDefault();
    // Hint to the OS that a drop is allowed; without this Chromium still
    // cancels the drop because the default is "copy" only on certain types.
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    const hasFiles = Array.from(e.dataTransfer.types).includes("Files");
    if (!hasFiles) return;
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    onDrop(files);
  }, [onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}