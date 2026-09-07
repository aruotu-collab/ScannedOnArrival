export interface CropInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that photo."));
    };
    image.src = url;
  });
}

async function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Could not save that page.");
  return new File([blob], name, { type: "image/jpeg" });
}

export async function cropImageFile(file: File, insets: CropInsets): Promise<File> {
  const image = await loadImage(file);
  const left = Math.round((Math.min(40, Math.max(0, insets.left)) / 100) * image.naturalWidth);
  const right = Math.round((Math.min(40, Math.max(0, insets.right)) / 100) * image.naturalWidth);
  const top = Math.round((Math.min(40, Math.max(0, insets.top)) / 100) * image.naturalHeight);
  const bottom = Math.round((Math.min(40, Math.max(0, insets.bottom)) / 100) * image.naturalHeight);
  const width = Math.max(32, image.naturalWidth - left - right);
  const height = Math.max(32, image.naturalHeight - top - bottom);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not crop that page.");
  ctx.drawImage(image, left, top, width, height, 0, 0, width, height);
  return canvasToFile(canvas, file.name.replace(/(\.\w+)?$/, "-crop.jpg"));
}

export async function enhanceDocument(file: File): Promise<File> {
  const image = await loadImage(file);
  const maxEdge = 2000;
  const scale = Math.min(1.35, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.filter = "contrast(1.28) brightness(1.06) saturate(0.82)";
  ctx.drawImage(image, 0, 0, width, height);
  ctx.filter = "none";
  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  const range = Math.max(18, max - min);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, ((data[i] - min) / range) * 255));
    data[i + 1] = Math.max(0, Math.min(255, ((data[i + 1] - min) / range) * 255));
    data[i + 2] = Math.max(0, Math.min(255, ((data[i + 2] - min) / range) * 255));
  }
  ctx.putImageData(pixels, 0, 0);
  return canvasToFile(canvas, file.name.replace(/(\.\w+)?$/, "-scan.jpg"));
}

export async function stitchImages(files: File[]): Promise<File> {
  if (files.length === 1) return files[0];
  const images = await Promise.all(files.map(loadImage));
  const width = Math.max(...images.map((image) => image.naturalWidth));
  const gap = 16;
  const heights = images.map((image) => Math.round((image.naturalHeight * width) / image.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = heights.reduce((sum, height) => sum + height, 0) + gap * (images.length - 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not join those pages.");
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  images.forEach((image, index) => {
    ctx.drawImage(image, 0, y, width, heights[index]);
    y += heights[index] + gap;
  });
  return canvasToFile(canvas, `scan-${files.length}p.jpg`);
}
