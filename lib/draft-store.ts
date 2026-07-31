export interface ChatDraftImage {
  data: string;
  mimeType: string;
  /**
   * Original filename recorded at attach time. The store tolerates older
   * drafts that predate this field by falling back to a MIME-derived name
   * on restore (see `chatDraftImageToFile`).
   */
  name?: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
}

const drafts = new Map<string, ChatDraft>();

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ data: image.data, mimeType: image.mimeType, ...(image.name ? { name: image.name } : {}) })),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key);
  return draft ? cloneDraft(draft) : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, cloneDraft(draft));
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

const EXT_FOR_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
};

const FALLBACK_NAME_BY_MIME: Record<string, string> = {
  "image/png": "image.png",
  "image/jpeg": "image.jpg",
  "image/gif": "image.gif",
  "image/webp": "image.webp",
  "image/bmp": "image.bmp",
  "image/avif": "image.avif",
  "image/svg+xml": "image.svg",
};

/**
 * Build a presentable filename for a draft image that did not record an
 * explicit original name (older drafts from before the field was added).
 * The returned name always carries an extension so the restored File is
 * treated as an image by the channel router.
 */
export function fallbackDraftImageName(mimeType: string): string {
  if (FALLBACK_NAME_BY_MIME[mimeType]) return FALLBACK_NAME_BY_MIME[mimeType];
  const ext = EXT_FOR_MIME[mimeType] ?? "bin";
  return `image.${ext}`;
}

/**
 * Convert a list of runtime `PendingAttachment`-like inputs into the
 * serialized shape that `setDraft` round-trips. Only entries with image
 * data (an existing `previewUrl` or a `File` whose name matches the
 * image extension list) are persisted. Each input contributes
 * `{ data, mimeType, name }`. Reads the underlying bytes via
 * `FileReader#readAsDataURL` so the conversion is browser-safe and
 * survives drafts that were attached long after the page first rendered.
 */
export async function serializeChatDraftImages(
  attachments: Array<{ file: { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> } | (Blob & { name?: string; type?: string }); previewUrl?: string }>,
): Promise<ChatDraftImage[]> {
  const out: ChatDraftImage[] = [];
  for (const att of attachments) {
    const file = att.file as Blob & { name?: string; type?: string };
    if (!file) continue;
    const mimeType = (file.type || (att.previewUrl?.match(/^data:([^;]+);/) ?? null)?.[1] || "").toLowerCase();
    if (!mimeType.startsWith("image/")) continue;
    const data = await readFileAsBase64(file);
    if (!data) continue;
    out.push({
      data,
      mimeType,
      name: typeof file.name === "string" && file.name ? file.name : fallbackDraftImageName(mimeType),
    });
  }
  return out;
}

function readFileAsBase64(file: Blob): Promise<string | null> {
  if (typeof (file as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === "function") {
    return file.arrayBuffer()
      .then((buffer) => bufferToBase64(new Uint8Array(buffer)))
      .catch(() => null);
  }
  return Promise.resolve(null);
}

function bufferToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // Browser fallback: chunk the bytes into a binary string and use btoa.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return typeof btoa === "function" ? btoa(binary) : "";
}

/**
 * Restore a serialised draft image as a real, uploadable `File`. The
 * `name` field carries the original filename (preserved on reload), and
 * the bytes are decoded back into a Blob so the upload pipeline can
 * stream them on send.
 */
export function chatDraftImageToFile(image: ChatDraftImage): File {
  const bytes = base64ToBytes(image.data);
  const name = image.name && image.name.length > 0
    ? image.name
    : fallbackDraftImageName(image.mimeType);
  // `bytes` is typed as `Uint8Array<ArrayBufferLike>` from the Buffer
  // path, but `File`'s constructor wants an `ArrayBufferView<ArrayBuffer>`.
  // Copy into a fresh ArrayBuffer to satisfy the type system without
  // changing the runtime bytes.
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  return new File([view], name, { type: image.mimeType });
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(0);
}
