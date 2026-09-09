import type { DocumentRecord } from "../types";
import { isPdfBlob } from "./pdf";
import { loadAllFileRecords, loadDocumentPages } from "./storage";

function safeBaseName(title: string, fileName?: string): string {
  const raw = (fileName ?? title).replace(/\.[^.]+$/, "");
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80) || "document";
}

function extensionFor(blob: Blob, mimeType?: string, fileName?: string): string {
  const fromName = (fileName ?? "").match(/(\.[a-z0-9]+)$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const type = (blob.type || mimeType || "").toLowerCase();
  if (type.includes("pdf")) return ".pdf";
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("heic")) return ".heic";
  if (type.includes("jpeg") || type.includes("jpg") || type.startsWith("image/")) return ".jpg";
  return ".bin";
}

function mimeFor(blob: Blob, ext: string, mimeType?: string): string {
  if (blob.type) return blob.type;
  if (mimeType) return mimeType;
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function asFile(blob: Blob, name: string, type: string): File {
  return blob instanceof File && blob.name ? blob : new File([blob], name, { type });
}

export async function filesForDocument(doc: DocumentRecord, extra?: File | null): Promise<File[]> {
  if (extra) {
    const ext = extensionFor(extra, extra.type, extra.name);
    return [asFile(extra, extra.name || `${safeBaseName(doc.title, extra.name)}${ext}`, extra.type || mimeFor(extra, ext))];
  }
  if (doc.storageKind !== "stored") return [];
  let blobs = await loadDocumentPages(doc.id, Math.max(1, doc.pageCount ?? 1));
  if (!blobs.length) {
    blobs = (await loadAllFileRecords())
      .filter((file) => file.documentId === doc.id || file.id === doc.id || file.id.startsWith(`${doc.id}::p`))
      .map((file) => file.blob);
  }
  if (!blobs.length) return [];
  const base = safeBaseName(doc.title, doc.fileName);
  return blobs.map((blob, index) => {
    const singleName = blobs.length === 1 ? doc.fileName : undefined;
    const pdf = isPdfBlob(blob, doc.mimeType, singleName ?? doc.fileName);
    const ext = pdf ? ".pdf" : extensionFor(blob, doc.mimeType, singleName);
    const name = blobs.length === 1 ? `${base}${ext}` : `${base}-${index + 1}${ext}`;
    return asFile(blob, name, mimeFor(blob, ext, doc.mimeType));
  });
}

export function canShareFiles(files: File[]): boolean {
  if (!files.length) return false;
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

function downloadFiles(files: File[]) {
  files.forEach((file, index) => {
    window.setTimeout(() => {
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, index * 280);
  });
}

export async function shareDocument(
  doc: DocumentRecord,
  extra?: File | null,
): Promise<"shared" | "downloaded" | "cancelled" | "empty"> {
  const files = await filesForDocument(doc, extra);
  if (!files.length) return "empty";
  if (canShareFiles(files)) {
    try {
      await navigator.share({
        files,
        title: doc.title,
        text: doc.title,
      });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    }
  }
  downloadFiles(files);
  return "downloaded";
}
