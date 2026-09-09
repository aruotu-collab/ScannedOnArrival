import { blobLooksLikePdf, isPdfBlob, renderPdfPages } from "./pdf";

export async function previewPagesFromBlob(
  blob: Blob,
  fileName?: string,
): Promise<Array<{ blob: Blob; image: boolean }>> {
  const treatAsPdf = isPdfBlob(blob, blob.type, fileName) || (await blobLooksLikePdf(blob));
  if (treatAsPdf) {
    try {
      const rendered = await renderPdfPages(blob);
      return rendered.map((page) => ({ blob: page, image: true }));
    } catch {
      return [{ blob, image: false }];
    }
  }
  if (blob.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic)$/i.test(fileName || "")) {
    return [{ blob, image: true }];
  }
  return [{ blob, image: false }];
}

export function urlsFromPreviewPages(pages: Array<{ blob: Blob; image: boolean }>) {
  const urls = pages.map((page) => URL.createObjectURL(page.blob));
  return {
    pages: pages.map((page, index) => ({ url: urls[index], image: page.image })),
    revoke: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  };
}
