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
    minConfidence: 0.34,
  },
  geometry: {
    minArea: 0.22,
    maxArea: 0.94,
    idealAreaMin: 0.4,
    idealAreaMax: 0.88,
    edgeMargin: 0.02,
    centreTolerance: 0.2,
    minPerspective: 0.58,
  },
  tracking: {
    smoothAlpha: 0.38,
    jumpFraction: 0.28,
    missTolerance: 5,
    stableFrames: 2,
    stableFraction: 0.03,
  },
  capture: {
    burstCount: 5,
    stabilityMs: 700,
    cooldownMs: 1200,
  },
} as const;
