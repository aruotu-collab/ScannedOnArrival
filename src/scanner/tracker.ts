import {
  analyzeQuad,
  lerpQuad,
  maxCornerTravel,
  type DocumentMetrics,
  type Quad,
} from "./geometry";
import { guidanceFromDetection, type Guidance } from "./guidance";
import { scannerConfig } from "./scannerConfig";

export type TrackedDetection = {
  corners: Quad | null;
  metrics: DocumentMetrics | null;
  confidence: number;
  stable: boolean;
  guidance: Guidance;
};

export class DocumentTracker {
  private smoothed: Quad | null = null;
  private lastAccepted: Quad | null = null;
  private misses = 0;
  private stableFrames = 0;
  private heldMessage = "Find the document";
  private pendingMessage = "";
  private pendingCount = 0;

  reset() {
    this.smoothed = null;
    this.lastAccepted = null;
    this.misses = 0;
    this.stableFrames = 0;
    this.heldMessage = "Find the document";
    this.pendingMessage = "";
    this.pendingCount = 0;
  }

  update(raw: Quad | null, width: number, height: number, confidence: number): TrackedDetection {
    const { smoothAlpha, jumpFraction, missTolerance, stableFrames } = scannerConfig.tracking;
    const diagonal = Math.hypot(width, height);

    let accepted = raw;
    if (raw && this.lastAccepted && maxCornerTravel(this.lastAccepted, raw) > diagonal * jumpFraction) {
      accepted = null;
    }

    const previous = this.lastAccepted;
    if (accepted && confidence >= scannerConfig.detection.minConfidence) {
      this.misses = 0;
      this.smoothed = this.smoothed ? lerpQuad(this.smoothed, accepted, smoothAlpha) : accepted;
      this.lastAccepted = accepted;
    } else {
      this.misses += 1;
      if (this.misses > missTolerance) {
        this.smoothed = null;
        this.lastAccepted = null;
        this.stableFrames = 0;
      }
    }

    const corners = this.smoothed;
    const metrics = corners ? analyzeQuad(corners, width, height, scannerConfig.geometry.edgeMargin) : null;
    const movement = previous && accepted ? maxCornerTravel(previous, accepted) : diagonal;
    const currentlyStable = Boolean(accepted && movement < diagonal * scannerConfig.tracking.stableFraction);
    this.stableFrames = currentlyStable ? this.stableFrames + 1 : 0;
    const stable = this.stableFrames >= stableFrames;
    const shownConfidence = corners ? Math.max(confidence, scannerConfig.detection.minConfidence) : confidence;
    const rawGuidance = guidanceFromDetection(metrics, corners ? shownConfidence : 0, stable);
    const guidance = { ...rawGuidance, message: this.holdMessage(rawGuidance.message) };

    return { corners, metrics, confidence: shownConfidence, stable, guidance };
  }

  private holdMessage(message: string): string {
    if (message === this.heldMessage) {
      this.pendingMessage = "";
      this.pendingCount = 0;
      return this.heldMessage;
    }
    if (message === this.pendingMessage) {
      this.pendingCount += 1;
      if (this.pendingCount >= 2) {
        this.heldMessage = message;
        return message;
      }
    } else {
      this.pendingMessage = message;
      this.pendingCount = 1;
    }
    return this.heldMessage;
  }
}
