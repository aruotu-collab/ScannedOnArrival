import { useEffect, useRef, useState, type MouseEvent } from "react";
import { detectFromVideo, drawScanOverlay, flattenCapturedFrame, loadOpenCV } from "../lib/detect";
import { DocumentTracker } from "./tracker";
import type { Quad } from "./geometry";
import {
  cameraErrorMessage,
  grabVideoFrame,
  hasCameraConsent,
  setTorch,
  startScannerCamera,
  stopScannerCamera,
  tapToFocus,
  type CameraSession,
} from "./camera";
import { scannerConfig } from "./scannerConfig";

export function ScannerScreen({
  pageCount,
  busy,
  busyLabel,
  onClose,
  onCaptured,
  onPickFromLibrary,
}: {
  pageCount: number;
  busy?: boolean;
  busyLabel?: string;
  onClose: () => void;
  onCaptured: (file: File) => Promise<void>;
  onPickFromLibrary: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const cornersRef = useRef<Quad | null>(null);
  const trackerRef = useRef(new DocumentTracker());
  const capturingRef = useRef(false);

  const [gate, setGate] = useState<"explain" | "live" | "error">(hasCameraConsent() ? "live" : "explain");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("Find the document");
  const [locked, setLocked] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (gate !== "live") return;
    let cancelled = false;
    void (async () => {
      try {
        const session = await startScannerCamera();
        if (cancelled) {
          stopScannerCamera(session);
          return;
        }
        sessionRef.current = session;
        setTorchAvailable(session.torch);
        if (videoRef.current) videoRef.current.srcObject = session.stream;
      } catch (err) {
        if (!cancelled) {
          setError(cameraErrorMessage(err));
          setGate("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      stopScannerCamera(sessionRef.current);
      sessionRef.current = null;
    };
  }, [gate]);

  useEffect(() => {
    if (gate !== "live") return;
    let alive = true;
    let raf = 0;
    let lastDetect = 0;
    trackerRef.current.reset();
    void loadOpenCV().catch(() => {
      if (alive) setHint("Find the document");
    });

    const tick = (now: number) => {
      if (!alive) return;
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (
        video &&
        overlay &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        now - lastDetect > scannerConfig.analysis.intervalMs &&
        !capturingRef.current
      ) {
        lastDetect = now;
        try {
          const result = detectFromVideo(video);
          const tracked = trackerRef.current.update(
            result.corners,
            result.frameWidth,
            result.frameHeight,
            result.confidence,
          );
          cornersRef.current = tracked.corners;
          setLocked(tracked.guidance.ready);
          setHint(tracked.guidance.message);
          drawScanOverlay(overlay, video, {
            ...result,
            corners: tracked.corners,
            locked: tracked.guidance.ready,
            hint: tracked.guidance.message,
            clipped: tracked.metrics?.clipped,
          });
        } catch {
          setHint("Find the document");
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [gate]);

  const closeSession = () => {
    stopScannerCamera(sessionRef.current);
    sessionRef.current = null;
    onClose();
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    setError(null);
    try {
      const file = cornersRef.current
        ? await flattenCapturedFrame(video, cornersRef.current)
        : await grabVideoFrame(video);
      await onCaptured(file);
    } catch {
      setError("Could not capture that page. Hold the letter in view and try again.");
      capturingRef.current = false;
      setCapturing(false);
    }
  };

  const toggleTorch = async () => {
    const session = sessionRef.current;
    if (!session) return;
    const next = await setTorch(session, !torchOn);
    setTorchOn(next);
  };

  const handlePreviewTap = (event: MouseEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session) return;
    const rect = event.currentTarget.getBoundingClientRect();
    void tapToFocus(session, event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
  };

  const libraryPicker = (
    <input
      type="file"
      accept="image/*"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onPickFromLibrary(file);
      }}
    />
  );

  if (gate !== "live") {
    return (
      <div className="scanner-screen scanner-gate">
        <button className="scanner-icon-btn" type="button" onClick={closeSession} aria-label="Close scanner">
          ×
        </button>
        <div className="scanner-gate-card">
          <p className="scanner-kicker">Private scan • processed on this device</p>
          <h2>Use your camera to scan documents</h2>
          <p>
            Point your phone at a letter on a contrasting table. Your document stays on this device — it is not
            uploaded.
          </p>
          {error && <p className="scanner-error">{error}</p>}
          <button
            className="primary"
            type="button"
            onClick={() => {
              setError(null);
              setGate("live");
            }}
          >
            Open camera
          </button>
          <label className="secondary scanner-roll">
            Use camera roll
            {libraryPicker}
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="scanner-screen">
      <div className="scanner-preview" onClick={handlePreviewTap}>
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas ref={overlayRef} className="scan-overlay" />
        <div className="scanner-top">
          <button className="scanner-icon-btn" type="button" onClick={closeSession} aria-label="Close scanner">
            ×
          </button>
          <p className="scanner-pages">{pageCount === 0 ? "Page 1" : `Page ${pageCount + 1}`}</p>
          {torchAvailable ? (
            <button
              className={`scanner-icon-btn ${torchOn ? "on" : ""}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void toggleTorch();
              }}
            >
              {torchOn ? "Flash on" : "Flash"}
            </button>
          ) : (
            <span className="scanner-icon-btn ghost" aria-hidden="true" />
          )}
        </div>
        <p className={`scanner-guidance ${locked ? "ok" : ""}`}>{capturing || busy ? busyLabel || "Saving this page…" : hint}</p>
        <p className="scanner-privacy">Private scan • processed on this device</p>
        <div className="scanner-bottom">
          <label className="scanner-text-btn">
            Library
            {libraryPicker}
          </label>
          <button
            className={`scanner-shutter ${locked ? "ready" : ""}`}
            type="button"
            disabled={capturing || busy}
            aria-label="Capture page"
            onClick={(event) => {
              event.stopPropagation();
              void capture();
            }}
          />
          <span className="scanner-status">{capturing || busy ? "Saving" : locked ? "Ready" : "Manual"}</span>
        </div>
      </div>
      {(capturing || busy) && (
        <div className="scanner-saving" role="status" aria-live="assertive">
          <strong>{busyLabel || "Saving this page…"}</strong>
          <span>Keep this tab open. The page is being cropped and stored on this device.</span>
        </div>
      )}
      {error && <p className="scanner-toast">{error}</p>}
    </div>
  );
}
