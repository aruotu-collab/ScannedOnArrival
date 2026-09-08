export const scannerConfig = {
  camera: {
    idealWidth: 1920,
    idealHeight: 1080,
    idealFrameRate: 30,
    fallbackFrameRate: 24,
  },
  analysis: {
    previewWidth: 640,
    intervalMs: 120,
  },
  detection: {
    minContourArea: 0.08,
    maxContourArea: 0.995,
    minConfidence: 0.28,
    keepCandidate: 0.18,
  },
  geometry: {
    minArea: 0.16,
    maxArea: 0.97,
    idealAreaMin: 0.32,
    idealAreaMax: 0.9,
    edgeMargin: 0.012,
    centreTolerance: 0.22,
    minPerspective: 0.5,
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
