export const scannerConfig = {
  camera: {
    idealWidth: 1920,
    idealHeight: 1080,
    idealFrameRate: 30,
    fallbackFrameRate: 24,
  },
  analysis: {
    previewWidth: 480,
    intervalMs: 140,
  },
  geometry: {
    minArea: 0.35,
    maxArea: 0.92,
    idealAreaMin: 0.55,
    idealAreaMax: 0.85,
    edgeMargin: 0.04,
    centreTolerance: 0.12,
  },
  capture: {
    burstCount: 5,
    stabilityMs: 700,
    cooldownMs: 1200,
  },
} as const;
