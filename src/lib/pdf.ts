import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function extractPdfText(file: File, maxPages = 3): Promise<string> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = Math.min(pdf.numPages, maxPages);
  const chunks: string[] = [];

  for (let i = 1; i <= pages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    chunks.push(text);
  }

  return chunks.join("\n");
}

export function isPdfBlob(blob: Blob, mimeType?: string, fileName?: string): boolean {
  const type = (blob.type || mimeType || "").toLowerCase();
  if (type.includes("pdf")) return true;
  return (fileName || "").toLowerCase().endsWith(".pdf");
}

export async function renderPdfPages(blob: Blob, maxPages = 40): Promise<Blob[]> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const pages: Blob[] = [];
  const targetWidth = Math.min(1600, Math.max(900, Math.round((globalThis.innerWidth || 900) * 2)));

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
    const pageBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("Could not render this page."))), "image/jpeg", 0.84);
    });
    pages.push(pageBlob);
  }

  await pdf.destroy();
  return pages;
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(file.name);
}
