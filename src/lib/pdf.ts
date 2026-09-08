import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function pdfHeaderOffset(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length, 1024) - 3;
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0x25 && bytes[index + 1] === 0x50 && bytes[index + 2] === 0x44 && bytes[index + 3] === 0x46) {
      return index;
    }
  }
  return -1;
}

function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

function maybeDecodeBase64Pdf(bytes: Uint8Array): Uint8Array {
  if (pdfHeaderOffset(bytes) >= 0) return bytes;
  const head = new TextDecoder().decode(bytes.subarray(0, 32)).replace(/^\uFEFF/, "").trimStart();
  if (!head.startsWith("JVBERi")) return bytes;
  try {
    const text = new TextDecoder().decode(bytes).replace(/\s/g, "");
    const binary = atob(text);
    const decoded = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) decoded[index] = binary.charCodeAt(index);
    return pdfHeaderOffset(decoded) >= 0 ? decoded : bytes;
  } catch {
    return bytes;
  }
}

function pdfBytesFromBuffer(bytes: Uint8Array): Uint8Array {
  const decoded = maybeDecodeBase64Pdf(bytes);
  const offset = pdfHeaderOffset(decoded);
  if (offset <= 0) return decoded;
  return decoded.subarray(offset);
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
  if (jpeg) return jpeg;
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (png) return png;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.84);
  const response = await fetch(dataUrl);
  return response.blob();
}

async function openPdf(blob: Blob) {
  const raw = new Uint8Array(await blob.arrayBuffer());
  const data = pdfBytesFromBuffer(raw).slice();
  return pdfjsLib.getDocument({
    data,
    disableRange: true,
    disableStream: true,
    isEvalSupported: false,
  }).promise;
}

async function renderPdfDocument(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>,
  maxPages: number,
  targetWidth: number,
): Promise<Blob[]> {
  const pageCount = Math.min(pdf.numPages, maxPages);
  const pages: Blob[] = [];

  for (let index = 1; index <= pageCount; index += 1) {
    const page = await pdf.getPage(index);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: targetWidth / Math.max(1, base.width) });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not draw this page.");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
    pages.push(await canvasToBlob(canvas));
    canvas.width = 0;
    canvas.height = 0;
  }

  return pages;
}

export async function extractPdfText(file: File, maxPages = 3): Promise<string> {
  const pdf = await openPdf(file);
  try {
    const pages = Math.min(pdf.numPages, maxPages);
    const chunks: string[] = [];

    for (let i = 1; i <= pages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      chunks.push(text);
    }

    return chunks.join("\n");
  } finally {
    await pdf.destroy();
  }
}

export function isPdfBlob(blob: Blob, mimeType?: string, fileName?: string): boolean {
  const type = (blob.type || mimeType || "").toLowerCase();
  if (type.startsWith("image/")) return false;
  if (type.includes("pdf")) return true;
  return (fileName || "").toLowerCase().endsWith(".pdf");
}

export async function blobLooksLikePdf(blob: Blob): Promise<boolean> {
  if (isPdfBlob(blob)) return true;
  const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  return pdfHeaderOffset(maybeDecodeBase64Pdf(head)) >= 0;
}

export async function normalizeDocumentFile(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfBytes = pdfBytesFromBuffer(bytes);
  if (pdfHeaderOffset(pdfBytes) >= 0) {
    const base = file.name.replace(/\.[^.]+$/, "") || "document";
    const name = file.name.toLowerCase().endsWith(".pdf") ? file.name : `${base}.pdf`;
    return new File([pdfBytes.slice()], name, { type: "application/pdf" });
  }
  const imageType = sniffImageType(bytes);
  if (imageType) {
    return new File([bytes], file.name, { type: imageType });
  }
  return file;
}

export async function rasterizePdfForStorage(file: File): Promise<File[]> {
  const rendered = await renderPdfPages(file);
  return rendered.map(
    (blob, index) => new File([blob], `page-${index + 1}.jpg`, { type: blob.type || "image/jpeg" }),
  );
}

export async function renderPdfPages(blob: Blob, maxPages = 40): Promise<Blob[]> {
  const preferredWidth = Math.min(1400, Math.max(720, Math.round((globalThis.innerWidth || 720) * 2)));
  try {
    const pdf = await openPdf(blob);
    try {
      return await renderPdfDocument(pdf, maxPages, preferredWidth);
    } finally {
      await pdf.destroy();
    }
  } catch {
    const pdf = await openPdf(blob);
    try {
      return await renderPdfDocument(pdf, maxPages, 720);
    } finally {
      await pdf.destroy();
    }
  }
}

export function isPdf(file: File): boolean {
  return isPdfBlob(file, file.type, file.name);
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(file.name);
}
