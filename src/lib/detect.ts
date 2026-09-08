import { getVideoLayout, videoPointToDisplay } from "../scanner/coordinates";
import {
  analyzeQuad,
  dist,
  orderQuad,
  scaleQuad,
  scoreDocumentCandidate,
  type Point,
  type Quad,
} from "../scanner/geometry";
import { scannerConfig } from "../scanner/scannerConfig";
import { bleachDarkBorders, PAPER_CREAM } from "./scan";

export type { Point, Quad };

export type DetectResult = {
  corners: Quad | null;
  locked: boolean;
  hint: string;
  frameWidth: number;
  frameHeight: number;
  confidence: number;
  clipped?: boolean;
};

type CvMat = {
  delete: () => void;
  clone?: () => CvMat;
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
  RETR_EXTERNAL: number;
  CHAIN_APPROX_SIMPLE: number;
  CV_32FC2: number;
  INTER_LINEAR: number;
  BORDER_CONSTANT: number;
  BORDER_REPLICATE: number;
  MORPH_RECT: number;
  THRESH_BINARY: number;
  THRESH_OTSU: number;
  getStructuringElement: (shape: number, size: unknown) => CvMat;
  threshold?: (src: CvMat, dst: CvMat, thresh: number, maxval: number, type: number) => void;
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
  Scalar?: new (v0?: number, v1?: number, v2?: number, v3?: number) => unknown;
  imshow: (canvas: HTMLCanvasElement, mat: CvMat) => void;
  onRuntimeInitialized?: () => void;
};

const OPENCV_SRC = "https://docs.opencv.org/4.7.0/opencv.js";

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

function considerCandidate(
  best: { quad: Quad; confidence: number } | null,
  points: Point[] | null,
  width: number,
  height: number,
): { quad: Quad; confidence: number } | null {
  if (!points) return best;
  const quad = orderQuad(points);
  const confidence = scoreDocumentCandidate(analyzeQuad(quad, width, height, scannerConfig.geometry.edgeMargin));
  if (!best || confidence > best.confidence) return { quad, confidence };
  return best;
}

function findBestDocument(
  api: OpenCV,
  mask: CvMat,
  width: number,
  height: number,
  mode: number,
): { quad: Quad; confidence: number } | null {
  const work = mask.clone?.() ?? mask;
  const contours = new api.MatVector();
  const hierarchy = new api.Mat();
  api.findContours(work, contours, hierarchy, mode, api.CHAIN_APPROX_SIMPLE);

  const frameArea = width * height;
  const { minContourArea, maxContourArea } = scannerConfig.detection;
  let best: { quad: Quad; confidence: number } | null = null;

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = api.contourArea(contour);
    if (area < frameArea * minContourArea || area > frameArea * maxContourArea) {
      contour.delete();
      continue;
    }
    const quadPoints = approxQuad(api, contour);
    const boxPoints = rectPoints(api, contour);
    contour.delete();
    best = considerCandidate(best, quadPoints, width, height);
    best = considerCandidate(best, boxPoints, width, height);
  }

  contours.delete();
  hierarchy.delete();
  if (work !== mask) work.delete();
  if (!best || best.confidence < scannerConfig.detection.keepCandidate) return null;
  return best;
}

function betterCandidate(
  current: { quad: Quad; confidence: number } | null,
  next: { quad: Quad; confidence: number } | null,
): { quad: Quad; confidence: number } | null {
  if (!next) return current;
  if (!current || next.confidence > current.confidence) return next;
  return current;
}

function detectOnEdges(
  api: OpenCV,
  blur: CvMat,
  kernel: CvMat,
  width: number,
  height: number,
  low: number,
  high: number,
): { quad: Quad; confidence: number } | null {
  const edges = new api.Mat();
  const dilated = new api.Mat();
  try {
    api.Canny(blur, edges, low, high);
    api.dilate(edges, dilated, kernel);
    return findBestDocument(api, dilated, width, height, api.RETR_LIST);
  } finally {
    edges.delete();
    dilated.delete();
  }
}

function detectOnPaperBlob(api: OpenCV, blur: CvMat, width: number, height: number): { quad: Quad; confidence: number } | null {
  if (!api.threshold) return null;
  const binary = new api.Mat();
  try {
    api.threshold(blur, binary, 0, 255, api.THRESH_BINARY + api.THRESH_OTSU);
    return findBestDocument(api, binary, width, height, api.RETR_EXTERNAL);
  } finally {
    binary.delete();
  }
}

export function detectPaperOnCanvas(source: HTMLCanvasElement): DetectResult {
  const width = source.width;
  const height = source.height;
  const empty: DetectResult = {
    corners: null,
    locked: false,
    hint: "Fit the whole page in the frame",
    frameWidth: width,
    frameHeight: height,
    confidence: 0,
  };

  const api = opencv();
  const src = api.imread(source);
  const gray = new api.Mat();
  const blur = new api.Mat();
  const kernel = api.getStructuringElement(api.MORPH_RECT, new api.Size(5, 5));

  try {
    api.cvtColor(src, gray, api.COLOR_RGBA2GRAY);
    api.GaussianBlur(gray, blur, new api.Size(5, 5), 0);
    let found = detectOnEdges(api, blur, kernel, width, height, 40, 140);
    if (!found || found.confidence < 0.45) {
      found = betterCandidate(found, detectOnEdges(api, blur, kernel, width, height, 20, 80));
    }
    if (!found || found.confidence < 0.45) {
      found = betterCandidate(found, detectOnPaperBlob(api, blur, width, height));
    }
    if (!found) return empty;
    const metrics = analyzeQuad(found.quad, width, height, scannerConfig.geometry.edgeMargin);
    return {
      corners: found.quad,
      locked: found.confidence >= 0.68 && !metrics.clipped,
      hint: "Fit the whole page in the frame",
      frameWidth: width,
      frameHeight: height,
      confidence: found.confidence,
      clipped: metrics.clipped,
    };
  } finally {
    src.delete();
    gray.delete();
    blur.delete();
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
      hint: "Fit the whole page in the frame",
      frameWidth: 1,
      frameHeight: 1,
      confidence: 0,
    };
  }

  const scale = Math.min(1, scannerConfig.analysis.previewWidth / nativeW);
  const width = Math.max(1, Math.round(nativeW * scale));
  const height = Math.max(1, Math.round(nativeH * scale));
  const canvas = getWorkCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      corners: null,
      locked: false,
      hint: "Fit the whole page in the frame",
      frameWidth: nativeW,
      frameHeight: nativeH,
      confidence: 0,
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

function expandQuad(quad: Quad, amount: number): Quad {
  const cx = (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4;
  const cy = (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4;
  const grow = (point: { x: number; y: number }) => ({
    x: point.x + (point.x - cx) * amount,
    y: point.y + (point.y - cy) * amount,
  });
  return {
    topLeft: grow(quad.topLeft),
    topRight: grow(quad.topRight),
    bottomRight: grow(quad.bottomRight),
    bottomLeft: grow(quad.bottomLeft),
  };
}

function warpPaper(source: HTMLCanvasElement, quad: Quad): HTMLCanvasElement {
  const api = opencv();
  const padded = expandQuad(quad, 0.012);
  const width = Math.max(
    32,
    Math.round(Math.max(dist(padded.topLeft, padded.topRight), dist(padded.bottomLeft, padded.bottomRight))),
  );
  const height = Math.max(
    32,
    Math.round(Math.max(dist(padded.topLeft, padded.bottomLeft), dist(padded.topRight, padded.bottomRight))),
  );
  const maxEdge = 2000;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const outW = Math.max(32, Math.round(width * scale));
  const outH = Math.max(32, Math.round(height * scale));
  const padTop = Math.round(outH * 0.055);
  const padSide = Math.round(outW * 0.03);
  const padBottom = Math.round(outH * 0.03);

  const src = api.imread(source);
  const warped = new api.Mat();
  const srcTri = api.matFromArray(4, 1, api.CV_32FC2, [
    padded.topLeft.x,
    padded.topLeft.y,
    padded.topRight.x,
    padded.topRight.y,
    padded.bottomLeft.x,
    padded.bottomLeft.y,
    padded.bottomRight.x,
    padded.bottomRight.y,
  ]);
  const dstTri = api.matFromArray(4, 1, api.CV_32FC2, [0, 0, outW, 0, 0, outH, outW, outH]);
  const matrix = api.getPerspectiveTransform(srcTri, dstTri);
  const paper = document.createElement("canvas");
  paper.width = outW;
  paper.height = outH;
  try {
    const cream = api.Scalar
      ? new api.Scalar(PAPER_CREAM.r, PAPER_CREAM.g, PAPER_CREAM.b, 255)
      : undefined;
    api.warpPerspective(
      src,
      warped,
      matrix,
      new api.Size(outW, outH),
      api.INTER_LINEAR,
      api.BORDER_CONSTANT,
      cream,
    );
    api.imshow(paper, warped);
    bleachDarkBorders(paper);
    const canvas = document.createElement("canvas");
    canvas.width = outW + padSide * 2;
    canvas.height = outH + padTop + padBottom;
    const ctx = canvas.getContext("2d");
    if (!ctx) return paper;
    ctx.fillStyle = `rgb(${PAPER_CREAM.r}, ${PAPER_CREAM.g}, ${PAPER_CREAM.b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(paper, padSide, padTop);
    return bleachDarkBorders(canvas);
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
    return canvasToJpeg(full, `scan-${Date.now()}.jpg`);
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

function pageGuide(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const insetX = width * 0.045;
  const insetY = height * 0.07;
  return { x: insetX, y: insetY, width: width - insetX * 2, height: height - insetY * 2 };
}

function strokeCorner(ctx: CanvasRenderingContext2D, point: Point, dx: number, dy: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(point.x, point.y + dy * size);
  ctx.lineTo(point.x, point.y);
  ctx.lineTo(point.x + dx * size, point.y);
  ctx.stroke();
}

function strokeGuideBrackets(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  size: number,
) {
  const { x, y, width, height } = box;
  ctx.beginPath();
  ctx.moveTo(x, y + size);
  ctx.lineTo(x, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x + width - size, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + size);
  ctx.moveTo(x + width, y + height - size);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width - size, y + height);
  ctx.moveTo(x + size, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + height - size);
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

  if (!result.corners) {
    const guide = pageGuide(displayW, displayH);
    ctx.save();
    ctx.strokeStyle = "rgba(247, 241, 228, 0.72)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokeGuideBrackets(ctx, guide, Math.max(28, Math.min(displayW, displayH) * 0.08));
    ctx.restore();
    return;
  }

  if (result.frameWidth < 2 || result.frameHeight < 2) return;

  const layout = getVideoLayout(video);
  const quad = {
    topLeft: videoPointToDisplay(result.corners.topLeft, layout),
    topRight: videoPointToDisplay(result.corners.topRight, layout),
    bottomRight: videoPointToDisplay(result.corners.bottomRight, layout),
    bottomLeft: videoPointToDisplay(result.corners.bottomLeft, layout),
  };
  const clipped = Boolean(result.clipped);
  ctx.save();
  ctx.fillStyle = result.locked ? "rgba(20, 40, 30, 0.28)" : "rgba(12, 10, 8, 0.32)";
  ctx.beginPath();
  ctx.rect(0, 0, displayW, displayH);
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.fill("evenodd");
  ctx.restore();

  ctx.strokeStyle = result.locked ? "#3d9a68" : clipped ? "#d4b36a" : "#c4a35a";
  ctx.lineWidth = result.locked ? 4 : 3.5;
  ctx.lineJoin = "round";
  ctx.setLineDash(clipped ? [10, 8] : []);
  ctx.beginPath();
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  const tick = Math.max(16, Math.min(displayW, displayH) * 0.045);
  strokeCorner(ctx, quad.topLeft, 1, 1, tick);
  strokeCorner(ctx, quad.topRight, -1, 1, tick);
  strokeCorner(ctx, quad.bottomRight, -1, -1, tick);
  strokeCorner(ctx, quad.bottomLeft, 1, -1, tick);
}
