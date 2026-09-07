export type Point = { x: number; y: number };

export type Quad = {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
};

export type DetectResult = {
  corners: Quad | null;
  locked: boolean;
  hint: string;
  frameWidth: number;
  frameHeight: number;
};

type CvMat = {
  delete: () => void;
  rows: number;
  data32S?: Int32Array;
  data32F?: Float32Array;
};

type CvMatVector = {
  size: () => number;
  get: (index: number) => CvMat;
  delete: () => void;
};

type OpenCV = {
  Mat: new () => CvMat;
  MatVector: new () => CvMatVector;
  Size: new (width: number, height: number) => unknown;
  COLOR_RGBA2GRAY: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
  CV_32FC2: number;
  INTER_LINEAR: number;
  BORDER_CONSTANT: number;
  MORPH_RECT: number;
  getStructuringElement: (shape: number, size: unknown) => CvMat;
  imread: (source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement) => CvMat;
  cvtColor: (src: CvMat, dst: CvMat, code: number) => void;
  GaussianBlur: (src: CvMat, dst: CvMat, size: unknown, sigma: number) => void;
  Canny: (src: CvMat, dst: CvMat, t1: number, t2: number) => void;
  dilate: (src: CvMat, dst: CvMat, kernel: CvMat) => void;
  findContours: (
    src: CvMat,
    contours: CvMatVector,
    hierarchy: CvMat,
    mode: number,
    method: number,
  ) => void;
  contourArea: (contour: CvMat) => number;
  arcLength: (contour: CvMat, closed: boolean) => number;
  approxPolyDP: (contour: CvMat, approx: CvMat, epsilon: number, closed: boolean) => void;
  isContourConvex: (contour: CvMat) => boolean;
  minAreaRect: (contour: CvMat) => { center: Point; size: { width: number; height: number }; angle: number };
  RotatedRect?: { points: (rect: unknown) => Point[] };
  matFromArray: (rows: number, cols: number, type: number, data: number[]) => CvMat;
  getPerspectiveTransform: (src: CvMat, dst: CvMat) => CvMat;
  warpPerspective: (
    src: CvMat,
    dst: CvMat,
    matrix: CvMat,
    size: unknown,
    flags: number,
    border: number,
    scalar?: unknown,
  ) => void;
  Scalar?: new () => unknown;
  imshow: (canvas: HTMLCanvasElement, mat: CvMat) => void;
  onRuntimeInitialized?: () => void;
};

const OPENCV_SRC = "https://docs.opencv.org/4.7.0/opencv.js";
const DETECT_WIDTH = 480;

let opencvPromise: Promise<void> | null = null;
let workCanvas: HTMLCanvasElement | null = null;

function opencv(): OpenCV {
  const api = (window as Window & { cv?: OpenCV }).cv;
  if (!api) throw new Error("Scanner engine is not ready.");
  return api;
}

function isOpenCvReady(): boolean {
  const api = (window as Window & { cv?: OpenCV }).cv;
  return Boolean(api && typeof api.Mat === "function" && api.imread);
}

export function loadOpenCV(): Promise<void> {
  if (isOpenCvReady()) {
    return Promise.resolve();
  }
  if (opencvPromise) return opencvPromise;

  opencvPromise = new Promise((resolve, reject) => {
    const ready = () => {
      if (isOpenCvReady()) {
        resolve();
        return true;
      }
      return false;
    };

    if (ready()) return;

    const existing = document.querySelector("script[data-soa-opencv]");
    const waitForRuntime = () => {
      const api = (window as Window & { cv?: OpenCV }).cv;
      if (!api) return;
      if (isOpenCvReady()) {
        resolve();
        return;
      }
      api.onRuntimeInitialized = () => resolve();
    };

    if (existing) {
      waitForRuntime();
      const timer = window.setInterval(() => {
        if (ready()) window.clearInterval(timer);
      }, 80);
      window.setTimeout(() => {
        window.clearInterval(timer);
        if (!ready()) reject(new Error("The scanner engine is taking too long to load."));
      }, 30000);
      return;
    }

    const script = document.createElement("script");
    script.src = OPENCV_SRC;
    script.async = true;
    script.dataset.soaOpencv = "1";
    script.onload = () => {
      if (ready()) return;
      waitForRuntime();
    };
    script.onerror = () => {
      opencvPromise = null;
      reject(new Error("Could not load the scanner engine. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });

  return opencvPromise;
}

function getWorkCanvas(width: number, height: number): HTMLCanvasElement {
  if (!workCanvas) workCanvas = document.createElement("canvas");
  if (workCanvas.width !== width || workCanvas.height !== height) {
    workCanvas.width = width;
    workCanvas.height = height;
  }
  return workCanvas;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orderQuad(points: Point[]): Quad {
  const sorted = [...points].sort((a, b) => a.y - b.y || a.x - b.x);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return {
    topLeft: top[0],
    topRight: top[1],
    bottomLeft: bottom[0],
    bottomRight: bottom[1],
  };
}

function scaleQuad(quad: Quad, scaleX: number, scaleY: number): Quad {
  const map = (point: Point): Point => ({ x: point.x * scaleX, y: point.y * scaleY });
  return {
    topLeft: map(quad.topLeft),
    topRight: map(quad.topRight),
    bottomRight: map(quad.bottomRight),
    bottomLeft: map(quad.bottomLeft),
  };
}

function quadArea(quad: Quad): number {
  const pts = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function quadAspect(quad: Quad): number {
  const width = Math.max(dist(quad.topLeft, quad.topRight), dist(quad.bottomLeft, quad.bottomRight));
  const height = Math.max(dist(quad.topLeft, quad.bottomLeft), dist(quad.topRight, quad.bottomRight));
  if (width < 1) return 0;
  return height / width;
}

function readPoints(mat: CvMat): Point[] {
  const points: Point[] = [];
  const count = mat.rows;
  const ints = mat.data32S;
  const floats = mat.data32F;
  for (let i = 0; i < count; i++) {
    if (ints && ints.length >= (i + 1) * 2) {
      points.push({ x: ints[i * 2], y: ints[i * 2 + 1] });
    } else if (floats && floats.length >= (i + 1) * 2) {
      points.push({ x: floats[i * 2], y: floats[i * 2 + 1] });
    }
  }
  return points;
}

function approxQuad(api: OpenCV, contour: CvMat): Point[] | null {
  const peri = api.arcLength(contour, true);
  for (const factor of [0.02, 0.03, 0.015, 0.04]) {
    const approx = new api.Mat();
    api.approxPolyDP(contour, approx, factor * peri, true);
    if (approx.rows === 4 && api.isContourConvex(approx)) {
      const points = readPoints(approx);
      approx.delete();
      if (points.length === 4) return points;
    } else {
      approx.delete();
    }
  }
  return null;
}

function rectPoints(api: OpenCV, contour: CvMat): Point[] | null {
  if (!api.RotatedRect?.points) return null;
  try {
    const points = api.RotatedRect.points(api.minAreaRect(contour));
    return points.length === 4 ? points : null;
  } catch {
    return null;
  }
}

function scoreQuad(quad: Quad, width: number, height: number): { locked: boolean; hint: string } {
  const fill = quadArea(quad) / Math.max(1, width * height);
  const aspect = quadAspect(quad);
  const paperLike = (aspect >= 1.15 && aspect <= 1.9) || (aspect >= 0.52 && aspect <= 0.88);
  const margin = 0.025;
  const inset = [quad.topLeft, quad.topRight, quad.bottomLeft, quad.bottomRight].every(
    (point) =>
      point.x > width * margin &&
      point.x < width * (1 - margin) &&
      point.y > height * margin &&
      point.y < height * (1 - margin),
  );

  if (fill < 0.18) return { locked: false, hint: "Move closer so the page fills more of the frame." };
  if (fill > 0.9) return { locked: false, hint: "Move back a little so all four edges are visible." };
  if (!inset) return { locked: false, hint: "Fit the whole page inside the frame." };
  if (!paperLike) return { locked: false, hint: "Hold the phone square-on to the page." };
  if (fill >= 0.24 && inset && paperLike) {
    return { locked: true, hint: "Looking good — tap Capture." };
  }
  return { locked: false, hint: "Fit the whole page inside the frame." };
}

function findQuadsFromEdges(api: OpenCV, edges: CvMat, width: number, height: number): Quad | null {
  const contours = new api.MatVector();
  const hierarchy = new api.Mat();
  api.findContours(edges, contours, hierarchy, api.RETR_LIST, api.CHAIN_APPROX_SIMPLE);

  const frameArea = width * height;
  let best: Quad | null = null;
  let bestArea = 0;

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = api.contourArea(contour);
    if (area < frameArea * 0.12 || area > frameArea * 0.96) {
      contour.delete();
      continue;
    }
    const points = approxQuad(api, contour) ?? (area > frameArea * 0.28 ? rectPoints(api, contour) : null);
    contour.delete();
    if (!points) continue;
    const quad = orderQuad(points);
    const quadA = quadArea(quad);
    if (quadA > bestArea) {
      best = quad;
      bestArea = quadA;
    }
  }

  contours.delete();
  hierarchy.delete();
  return best;
}

export function detectPaperOnCanvas(source: HTMLCanvasElement): DetectResult {
  const width = source.width;
  const height = source.height;
  const empty: DetectResult = {
    corners: null,
    locked: false,
    hint: "Lay the page flat on a contrasting surface.",
    frameWidth: width,
    frameHeight: height,
  };

  const api = opencv();
  const src = api.imread(source);
  const gray = new api.Mat();
  const blur = new api.Mat();
  const edges = new api.Mat();
  const dilated = new api.Mat();
  const kernel = api.getStructuringElement(api.MORPH_RECT, new api.Size(3, 3));

  try {
    api.cvtColor(src, gray, api.COLOR_RGBA2GRAY);
    api.GaussianBlur(gray, blur, new api.Size(5, 5), 0);
    api.Canny(blur, edges, 50, 160);
    api.dilate(edges, dilated, kernel);
    const corners = findQuadsFromEdges(api, dilated, width, height);
    if (!corners) return empty;
    const score = scoreQuad(corners, width, height);
    return {
      corners,
      locked: score.locked,
      hint: score.hint,
      frameWidth: width,
      frameHeight: height,
    };
  } finally {
    src.delete();
    gray.delete();
    blur.delete();
    edges.delete();
    dilated.delete();
    kernel.delete();
  }
}

export function detectFromVideo(video: HTMLVideoElement): DetectResult {
  const nativeW = video.videoWidth;
  const nativeH = video.videoHeight;
  if (!nativeW || !nativeH) {
    return {
      corners: null,
      locked: false,
      hint: "Allow the camera, then hold one page in view.",
      frameWidth: 1,
      frameHeight: 1,
    };
  }

  const scale = Math.min(1, DETECT_WIDTH / nativeW);
  const width = Math.max(1, Math.round(nativeW * scale));
  const height = Math.max(1, Math.round(nativeH * scale));
  const canvas = getWorkCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      corners: null,
      locked: false,
      hint: "Could not read the camera frame.",
      frameWidth: nativeW,
      frameHeight: nativeH,
    };
  }
  ctx.drawImage(video, 0, 0, width, height);
  const result = detectPaperOnCanvas(canvas);
  return {
    ...result,
    corners: result.corners ? scaleQuad(result.corners, 1 / scale, 1 / scale) : null,
    frameWidth: nativeW,
    frameHeight: nativeH,
  };
}

function warpPaper(source: HTMLCanvasElement, quad: Quad): HTMLCanvasElement {
  const api = opencv();
  const width = Math.max(
    32,
    Math.round(Math.max(dist(quad.topLeft, quad.topRight), dist(quad.bottomLeft, quad.bottomRight))),
  );
  const height = Math.max(
    32,
    Math.round(Math.max(dist(quad.topLeft, quad.bottomLeft), dist(quad.topRight, quad.bottomRight))),
  );
  const maxEdge = 2000;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const outW = Math.max(32, Math.round(width * scale));
  const outH = Math.max(32, Math.round(height * scale));

  const src = api.imread(source);
  const warped = new api.Mat();
  const srcTri = api.matFromArray(4, 1, api.CV_32FC2, [
    quad.topLeft.x,
    quad.topLeft.y,
    quad.topRight.x,
    quad.topRight.y,
    quad.bottomLeft.x,
    quad.bottomLeft.y,
    quad.bottomRight.x,
    quad.bottomRight.y,
  ]);
  const dstTri = api.matFromArray(4, 1, api.CV_32FC2, [0, 0, outW, 0, 0, outH, outW, outH]);
  const matrix = api.getPerspectiveTransform(srcTri, dstTri);
  const canvas = document.createElement("canvas");
  try {
    api.warpPerspective(src, warped, matrix, new api.Size(outW, outH), api.INTER_LINEAR, api.BORDER_CONSTANT);
    api.imshow(canvas, warped);
    return canvas;
  } finally {
    src.delete();
    warped.delete();
    srcTri.delete();
    dstTri.delete();
    matrix.delete();
  }
}

async function canvasToJpeg(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.93));
  if (!blob) throw new Error("Could not save that page.");
  return new File([blob], name, { type: "image/jpeg" });
}

function loadImageEl(file: File): Promise<HTMLImageElement> {
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

export async function flattenCapturedFrame(video: HTMLVideoElement, hint?: Quad | null): Promise<File> {
  await loadOpenCV();
  const full = document.createElement("canvas");
  full.width = video.videoWidth || 1920;
  full.height = video.videoHeight || 1080;
  const ctx = full.getContext("2d");
  if (!ctx) throw new Error("Could not capture that frame.");
  ctx.drawImage(video, 0, 0);
  const refined = detectPaperOnCanvas(full);
  const quad = refined.corners ?? hint ?? null;
  if (!quad) {
    throw new Error("Could not see the page edges. Lay it flat on a contrasting table and try again.");
  }
  return canvasToJpeg(warpPaper(full, quad), `scan-${Date.now()}.jpg`);
}

export async function flattenImageFile(file: File): Promise<File> {
  try {
    await loadOpenCV();
  } catch {
    return file;
  }
  const image = await loadImageEl(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(image, 0, 0);
  const detected = detectPaperOnCanvas(canvas);
  if (!detected.corners) return file;
  return canvasToJpeg(warpPaper(canvas, detected.corners), file.name.replace(/(\.\w+)?$/, "-flat.jpg"));
}

function a4Guide(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const ratio = 1 / Math.SQRT2;
  let boxH = height * 0.78;
  let boxW = boxH * ratio;
  if (boxW > width * 0.82) {
    boxW = width * 0.82;
    boxH = boxW / ratio;
  }
  return { x: (width - boxW) / 2, y: (height - boxH) / 2, width: boxW, height: boxH };
}

function strokeCorner(ctx: CanvasRenderingContext2D, point: Point, dx: number, dy: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(point.x, point.y + dy * size);
  ctx.lineTo(point.x, point.y);
  ctx.lineTo(point.x + dx * size, point.y);
  ctx.stroke();
}

export function drawScanOverlay(canvas: HTMLCanvasElement, video: HTMLVideoElement, result: DetectResult) {
  const displayW = video.clientWidth || 1;
  const displayH = video.clientHeight || 1;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(displayW * dpr) || canvas.height !== Math.round(displayH * dpr)) {
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayW, displayH);

  const guide = a4Guide(displayW, displayH);
  ctx.save();
  ctx.strokeStyle = result.locked ? "rgba(47, 122, 88, 0.35)" : "rgba(247, 241, 228, 0.5)";
  ctx.setLineDash([7, 7]);
  ctx.lineWidth = 2;
  ctx.strokeRect(guide.x, guide.y, guide.width, guide.height);
  ctx.restore();

  if (!result.corners || result.frameWidth < 2 || result.frameHeight < 2) return;

  const quad = scaleQuad(result.corners, displayW / result.frameWidth, displayH / result.frameHeight);
  ctx.save();
  ctx.fillStyle = result.locked ? "rgba(20, 40, 30, 0.28)" : "rgba(12, 10, 8, 0.38)";
  ctx.beginPath();
  ctx.rect(0, 0, displayW, displayH);
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.fill("evenodd");
  ctx.restore();

  ctx.strokeStyle = result.locked ? "#3d9a68" : "#c4a35a";
  ctx.lineWidth = 3.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();

  const tick = Math.max(16, Math.min(displayW, displayH) * 0.045);
  strokeCorner(ctx, quad.topLeft, 1, 1, tick);
  strokeCorner(ctx, quad.topRight, -1, 1, tick);
  strokeCorner(ctx, quad.bottomRight, -1, -1, tick);
  strokeCorner(ctx, quad.bottomLeft, 1, -1, tick);
}
