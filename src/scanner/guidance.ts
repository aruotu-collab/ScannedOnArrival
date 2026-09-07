import type { DocumentMetrics } from "./geometry";
import { scannerConfig } from "./scannerConfig";

export type Guidance = {
  message: string;
  ready: boolean;
  reason: string;
};

export function guidanceFromDetection(
  metrics: DocumentMetrics | null,
  confidence: number,
  stable: boolean,
): Guidance {
  const { minArea, maxArea, idealAreaMin, idealAreaMax, centreTolerance } = scannerConfig.geometry;
  const { minConfidence } = scannerConfig.detection;

  if (!metrics || confidence < minConfidence) {
    return { message: "Find the document", ready: false, reason: "no-document" };
  }
  if (metrics.clipped || metrics.edgeCompleteness < 1) {
    return {
      message: metrics.areaRatio > maxArea - 0.04 ? "Move further away" : "Show all 4 corners",
      ready: false,
      reason: "clipped",
    };
  }
  if (metrics.areaRatio < minArea) {
    return { message: "Move closer", ready: false, reason: "too-far" };
  }
  if (metrics.areaRatio > maxArea) {
    return { message: "Move further away", ready: false, reason: "too-close" };
  }
  if (Math.abs(metrics.centreOffsetX) > centreTolerance && Math.abs(metrics.centreOffsetX) >= Math.abs(metrics.centreOffsetY)) {
    return {
      message: metrics.centreOffsetX < 0 ? "Move left" : "Move right",
      ready: false,
      reason: "off-centre",
    };
  }
  if (Math.abs(metrics.centreOffsetY) > centreTolerance) {
    return {
      message: metrics.centreOffsetY < 0 ? "Move up" : "Move down",
      ready: false,
      reason: "off-centre",
    };
  }
  if (metrics.perspectiveScore < scannerConfig.geometry.minPerspective) {
    return { message: "Hold phone parallel", ready: false, reason: "perspective" };
  }
  if (!stable) {
    return { message: "Hold steady", ready: false, reason: "motion" };
  }
  if (metrics.areaRatio < idealAreaMin || metrics.areaRatio > idealAreaMax) {
    return {
      message: metrics.areaRatio < idealAreaMin ? "Move closer" : "Move further away",
      ready: false,
      reason: "size",
    };
  }
  return { message: "Ready", ready: true, reason: "ready" };
}
