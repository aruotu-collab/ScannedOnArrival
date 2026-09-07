export const scannerConfig = {
  camera: {
    idealWidth: 1920,
    idealHeight: 1080,
    idealFrameRate: 30,
    fallbackFrameRate: 24,
  },
  analysis: {
    previewWidth: 480,
    intervalMs: 120,
  },
  detection: {
    minContourArea: 0.1,
    maxContourArea: 0.96,
    minConfidence: 0.42,
  },
  geometry: {
    minArea: 0.35,
    maxArea: 0.9,
    idealAreaMin: 0.55,
    idealAreaMax: 0.85,
    edgeMargin: 0.04,
    centreTolerance: 0.12,
    minPerspective: 0.72,
  },
  tracking: {
    smoothAlpha: 0.32,
    jumpFraction: 0.22,
    missTolerance: 4,
    stableFrames: 4,
    stableFraction: 0.018,
  },
  capture: {
    burstCount: 5,
    stabilityMs: 700,
    cooldownMs: 1200,
  },
} as const;
