import {
  DEMO_DESK_H,
  DEMO_DESK_W,
  DEMO_LETTER_AREA,
  DEMO_LETTER_CENTER,
  DEMO_START_POSE,
  type DemoPoint,
} from "./demoLetter";
import { analyzeQuad, orderQuad, type Point, type Quad } from "../scanner/geometry";
import type { Guidance } from "../scanner/guidance";

export type DemoPose = {
  cx: number;
  cy: number;
  viewH: number;
  tiltX: number;
  tiltY: number;
};

const MIN_VIEW = 1080;
const MAX_VIEW = 3400;

export function createDemoPose(): DemoPose {
  return {
    cx: DEMO_START_POSE.cx,
    cy: DEMO_START_POSE.cy,
    viewH: DEMO_START_POSE.viewH,
    tiltX: 0,
    tiltY: 0,
  };
}

export function idealDemoPose(screenW: number, screenH: number): DemoPose {
  const aspect = screenW / Math.max(1, screenH);
  const visible = DEMO_LETTER_AREA / 0.5;
  return {
    cx: DEMO_LETTER_CENTER.x,
    cy: DEMO_LETTER_CENTER.y,
    viewH: Math.sqrt(visible / aspect),
    tiltX: 0,
    tiltY: 0,
  };
}

export function pullTowardIdeal(pose: DemoPose, ideal: DemoPose, amount: number): DemoPose {
  const mix = (from: number, to: number) => from + (to - from) * amount;
  return clampDemoPose({
    cx: mix(pose.cx, ideal.cx),
    cy: mix(pose.cy, ideal.cy),
    viewH: mix(pose.viewH, ideal.viewH),
    tiltX: mix(pose.tiltX, 0),
    tiltY: mix(pose.tiltY, 0),
  });
}

export function clampDemoPose(pose: DemoPose): DemoPose {
  return {
    cx: Math.min(DEMO_DESK_W + 240, Math.max(-240, pose.cx)),
    cy: Math.min(DEMO_DESK_H + 240, Math.max(-240, pose.cy)),
    viewH: Math.min(MAX_VIEW, Math.max(MIN_VIEW, pose.viewH)),
    tiltX: Math.min(0.38, Math.max(-0.38, pose.tiltX)),
    tiltY: Math.min(0.38, Math.max(-0.38, pose.tiltY)),
  };
}

export function visibleDeskSize(pose: DemoPose, screenW: number, screenH: number) {
  const viewH = pose.viewH;
  const viewW = viewH * (screenW / Math.max(1, screenH));
  return { viewW, viewH };
}

export function deskImageStyle(pose: DemoPose, screenW: number, screenH: number) {
  const { viewW, viewH } = visibleDeskSize(pose, screenW, screenH);
  const scaleX = screenW / viewW;
  const scaleY = screenH / viewH;
  return {
    width: `${DEMO_DESK_W * scaleX}px`,
    height: `${DEMO_DESK_H * scaleY}px`,
    left: `${-(pose.cx - viewW / 2) * scaleX}px`,
    top: `${-(pose.cy - viewH / 2) * scaleY}px`,
    transform: "none",
  };
}

export function projectLetterQuad(
  corners: DemoPoint[],
  pose: DemoPose,
  screenW: number,
  screenH: number,
): Quad {
  const { viewW, viewH } = visibleDeskSize(pose, screenW, screenH);
  const left = pose.cx - viewW / 2;
  const top = pose.cy - viewH / 2;
  const points = corners.map((point) => {
    let x = ((point.x - left) / viewW) * screenW;
    let y = ((point.y - top) / viewH) * screenH;
    const nx = x / screenW - 0.5;
    const ny = y / screenH - 0.5;
    x += ny * pose.tiltX * screenW;
    y += nx * pose.tiltY * screenH;
    return { x, y };
  });
  return orderQuad(points);
}

function cornersOnScreen(quad: Quad, width: number, height: number) {
  const pad = 18;
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft].filter(
    (point) => point.x > -pad && point.x < width + pad && point.y > -pad && point.y < height + pad,
  ).length;
}

export function demoGuidance(quad: Quad, width: number, height: number, held: boolean): Guidance {
  const seen = cornersOnScreen(quad, width, height);
  if (seen < 2) {
    return { message: "Find the document", ready: false, reason: "no-document" };
  }
  const metrics = analyzeQuad(quad, width, height);
  if (metrics.areaRatio < 0.18) {
    return { message: "Move closer", ready: false, reason: "too-far" };
  }
  if (metrics.areaRatio > 0.9) {
    return { message: "Move further away", ready: false, reason: "too-close" };
  }
  if (Math.abs(metrics.centreOffsetX) > 0.3 && Math.abs(metrics.centreOffsetX) >= Math.abs(metrics.centreOffsetY)) {
    return { message: metrics.centreOffsetX < 0 ? "Move left" : "Move right", ready: false, reason: "off-centre" };
  }
  if (Math.abs(metrics.centreOffsetY) > 0.3) {
    return { message: metrics.centreOffsetY < 0 ? "Move up" : "Move down", ready: false, reason: "off-centre" };
  }
  if (!held) {
    return { message: "Hold steady", ready: false, reason: "motion" };
  }
  return { message: "Ready", ready: true, reason: "ready" };
}

export function letterMostlyInView(quad: Quad, width: number, height: number) {
  const metrics = analyzeQuad(quad, width, height);
  return (
    cornersOnScreen(quad, width, height) >= 3 &&
    metrics.areaRatio >= 0.2 &&
    metrics.areaRatio <= 0.88 &&
    Math.abs(metrics.centreOffsetX) < 0.26 &&
    Math.abs(metrics.centreOffsetY) < 0.26
  );
}

export function poseTravel(a: DemoPose, b: DemoPose) {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy) / 140 + Math.abs(a.viewH - b.viewH) / 90 + Math.abs(a.tiltX - b.tiltX) + Math.abs(a.tiltY - b.tiltY);
}

export async function enableDemoMotion(): Promise<boolean> {
  const Orientation = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  if (typeof Orientation.requestPermission === "function") {
    try {
      return (await Orientation.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

export function drawDemoOverlay(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  quad: Quad | null,
  locked: boolean,
  clipped: boolean,
) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const ratio = 1 / Math.SQRT2;
  let boxH = height * 0.78;
  let boxW = boxH * ratio;
  if (boxW > width * 0.82) {
    boxW = width * 0.82;
    boxH = boxW / ratio;
  }
  ctx.save();
  ctx.strokeStyle = locked ? "rgba(47, 122, 88, 0.35)" : "rgba(247, 241, 228, 0.5)";
  ctx.setLineDash([7, 7]);
  ctx.lineWidth = 2;
  ctx.strokeRect((width - boxW) / 2, (height - boxH) / 2, boxW, boxH);
  ctx.restore();

  if (!quad) return;

  ctx.save();
  ctx.fillStyle = locked ? "rgba(20, 40, 30, 0.28)" : "rgba(12, 10, 8, 0.32)";
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.moveTo(quad.topLeft.x, quad.topLeft.y);
  ctx.lineTo(quad.topRight.x, quad.topRight.y);
  ctx.lineTo(quad.bottomRight.x, quad.bottomRight.y);
  ctx.lineTo(quad.bottomLeft.x, quad.bottomLeft.y);
  ctx.closePath();
  ctx.fill("evenodd");
  ctx.restore();

  ctx.strokeStyle = locked ? "#3d9a68" : clipped ? "#d4b36a" : "#c4a35a";
  ctx.lineWidth = locked ? 4 : 3.5;
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

  const tick = Math.max(16, Math.min(width, height) * 0.045);
  strokeCorner(ctx, quad.topLeft, 1, 1, tick);
  strokeCorner(ctx, quad.topRight, -1, 1, tick);
  strokeCorner(ctx, quad.bottomRight, -1, -1, tick);
  strokeCorner(ctx, quad.bottomLeft, 1, -1, tick);
}

function strokeCorner(ctx: CanvasRenderingContext2D, point: Point, dx: number, dy: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(point.x, point.y + dy * size);
  ctx.lineTo(point.x, point.y);
  ctx.lineTo(point.x + dx * size, point.y);
  ctx.stroke();
}
