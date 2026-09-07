import { scannerConfig } from "./scannerConfig";

export type CameraSession = {
  stream: MediaStream;
  track: MediaStreamTrack;
  torch: boolean;
  tapToFocus: boolean;
};

type VideoTrackCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  focusMode?: string[];
  exposureMode?: string[];
  pointsOfInterest?: unknown;
};

type VideoTrackConstraintSet = MediaTrackConstraintSet & {
  torch?: boolean;
  focusMode?: string;
  exposureMode?: string;
  pointsOfInterest?: Array<{ x: number; y: number }>;
};

let sessionConsent = false;

export function hasCameraConsent(): boolean {
  return sessionConsent;
}

export function markCameraConsent(): void {
  sessionConsent = true;
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was declined. Allow the camera in your browser settings, or pick a photo from your camera roll.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device. You can still pick a photo from your camera roll.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is in use by another app. Close that app and try again.";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "This camera could not start at the requested quality. Try again, or pick a photo from your camera roll.";
  }
  if (name === "SecurityError") {
    return "The camera needs a secure connection. Open ScannedOnArrival over https and try again.";
  }
  return "The camera could not start. You can still pick a photo from your camera roll.";
}

function videoConstraints(level: "high" | "simple" | "any"): MediaTrackConstraints | boolean {
  const { idealWidth, idealHeight, idealFrameRate } = scannerConfig.camera;
  if (level === "any") return true;
  if (level === "simple") {
    return { facingMode: { ideal: "environment" } };
  }
  return {
    facingMode: { ideal: "environment" },
    width: { ideal: idealWidth },
    height: { ideal: idealHeight },
    frameRate: { ideal: idealFrameRate },
  };
}

async function applyPreferredControls(track: MediaStreamTrack): Promise<void> {
  const capabilities = (track.getCapabilities?.() ?? {}) as VideoTrackCapabilities;
  const advanced: VideoTrackConstraintSet[] = [];
  if (capabilities.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
  if (capabilities.exposureMode?.includes("continuous")) advanced.push({ exposureMode: "continuous" });
  if (!advanced.length) return;
  try {
    await track.applyConstraints({ advanced });
  } catch {
    /* optional controls are not required */
  }
}

function inspectTrack(track: MediaStreamTrack): Pick<CameraSession, "torch" | "tapToFocus"> {
  const capabilities = (track.getCapabilities?.() ?? {}) as VideoTrackCapabilities;
  return {
    torch: Boolean(capabilities.torch),
    tapToFocus: Boolean(capabilities.pointsOfInterest || capabilities.focusMode?.includes("single-shot")),
  };
}

export async function startScannerCamera(): Promise<CameraSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Camera is not available in this browser.", "NotSupportedError");
  }

  const attempts: Array<MediaTrackConstraints | boolean> = [
    videoConstraints("high"),
    videoConstraints("simple"),
    videoConstraints("any"),
  ];

  let lastError: unknown = null;
  for (const video of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((item) => item.stop());
        throw new DOMException("No camera track was returned.", "NotFoundError");
      }
      await applyPreferredControls(track);
      markCameraConsent();
      return { stream, track, ...inspectTrack(track) };
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The camera could not start.");
}

export function stopScannerCamera(session: CameraSession | null): void {
  session?.stream.getTracks().forEach((track) => track.stop());
}

export async function setTorch(session: CameraSession, on: boolean): Promise<boolean> {
  if (!session.torch) return false;
  try {
    await session.track.applyConstraints({
      advanced: [{ torch: on } as VideoTrackConstraintSet],
    });
    return on;
  } catch {
    return false;
  }
}

export async function tapToFocus(
  session: CameraSession,
  displayX: number,
  displayY: number,
  displayWidth: number,
  displayHeight: number,
): Promise<void> {
  if (!session.tapToFocus) return;
  const x = Math.min(1, Math.max(0, displayX / Math.max(1, displayWidth)));
  const y = Math.min(1, Math.max(0, displayY / Math.max(1, displayHeight)));
  try {
    await session.track.applyConstraints({
      advanced: [{ pointsOfInterest: [{ x, y }] } as VideoTrackConstraintSet],
    });
  } catch {
    /* tap-to-focus is optional */
  }
}

export async function grabVideoFrame(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1920;
  canvas.height = video.videoHeight || 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not capture that frame.");
  ctx.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.93));
  if (!blob) throw new Error("Could not capture that frame.");
  return new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" });
}
