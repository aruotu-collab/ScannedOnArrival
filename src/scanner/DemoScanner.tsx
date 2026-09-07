import { useEffect, useRef, useState, type PointerEvent } from "react";
import { demoLetterCornersPx } from "../lib/demoLetter";
import {
  clampDemoPose,
  createDemoPose,
  demoGuidance,
  deskImageStyle,
  drawDemoOverlay,
  idealDemoPose,
  letterMostlyInView,
  pullTowardIdeal,
  projectLetterQuad,
  type DemoPose,
} from "../lib/demoScan";

const letterCorners = demoLetterCornersPx();

export function DemoScanner({
  deskUrl,
  onClose,
  onCaptured,
}: {
  deskUrl: string;
  onClose: () => void;
  onCaptured: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const poseRef = useRef<DemoPose>(createDemoPose());
  const baseRef = useRef<DemoPose>(createDemoPose());
  const lastOrientRef = useRef<{ beta: number; gamma: number } | null>(null);
  const goodFramesRef = useRef(0);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ id: number; x: number; y: number; cx: number; cy: number } | null>(null);
  const pinchRef = useRef<{ dist: number; viewH: number } | null>(null);
  const capturingRef = useRef(false);

  const [hint, setHint] = useState("Hold the phone over the letter");
  const [locked, setLocked] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hasMotion, setHasMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let lastUi = 0;

    const tick = (now: number) => {
      if (!alive) return;
      const box = previewRef.current;
      const img = imgRef.current;
      const overlay = overlayRef.current;
      if (box && img && overlay) {
        const width = box.clientWidth;
        const height = box.clientHeight;
        if (!capturingRef.current) {
          const dragging = Boolean(dragRef.current || pinchRef.current);
          poseRef.current = pullTowardIdeal(poseRef.current, idealDemoPose(width, height), dragging ? 0.025 : 0.065);
          if (!dragging) {
            baseRef.current = { ...poseRef.current, tiltX: 0, tiltY: 0 };
          }
        }
        const pose = poseRef.current;
        const style = deskImageStyle(pose, width, height);
        img.style.width = style.width;
        img.style.height = style.height;
        img.style.left = style.left;
        img.style.top = style.top;
        img.style.transform = style.transform;

        const quad = projectLetterQuad(letterCorners, pose, width, height);
        const good = letterMostlyInView(quad, width, height);
        if (good) goodFramesRef.current += 1;
        else goodFramesRef.current = 0;
        const held = goodFramesRef.current >= 16;
        const guidance = capturingRef.current
          ? { message: "Saving this page…", ready: true, reason: "saving" }
          : demoGuidance(quad, width, height, held);

        if (now - lastUi > 80) {
          lastUi = now;
          setHint(guidance.message);
          setLocked(guidance.ready);
        }
        drawDemoOverlay(overlay, width, height, quad, guidance.ready, !good);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const onOrient = (event: DeviceOrientationEvent) => {
      if (capturingRef.current || dragRef.current || pinchRef.current) return;
      if (event.beta == null || event.gamma == null) return;
      if (!lastOrientRef.current) {
        lastOrientRef.current = { beta: event.beta, gamma: event.gamma };
        return;
      }
      const last = lastOrientRef.current;
      const dBeta = event.beta - last.beta;
      const dGamma = event.gamma - last.gamma;
      lastOrientRef.current = { beta: event.beta, gamma: event.gamma };
      if (Math.hypot(dBeta, dGamma) < 0.35) return;
      if (!hasMotion) setHasMotion(true);
      const pose = poseRef.current;
      poseRef.current = clampDemoPose({
        cx: pose.cx + dGamma * 5,
        cy: pose.cy + dBeta * 5,
        viewH: pose.viewH - dBeta * 3,
        tiltX: 0,
        tiltY: 0,
      });
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [hasMotion]);

  const syncBase = (next: DemoPose) => {
    const clamped = clampDemoPose(next);
    baseRef.current = { ...clamped, tiltX: 0, tiltY: 0 };
    poseRef.current = clamped;
  };

  const pointerList = () => [...pointersRef.current.values()];

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (capturingRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = pointerList();
    if (points.length === 2) {
      pinchRef.current = {
        dist: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        viewH: poseRef.current.viewH,
      };
      dragRef.current = null;
      return;
    }
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cx: poseRef.current.cx,
      cy: poseRef.current.cy,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const box = previewRef.current;
    if (!box) return;
    const points = pointerList();
    if (points.length >= 2 && pinchRef.current) {
      const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const ratio = pinchRef.current.dist / Math.max(40, dist);
      syncBase({
        ...poseRef.current,
        viewH: pinchRef.current.viewH * ratio,
      });
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const scale = poseRef.current.viewH / Math.max(1, box.clientHeight);
    syncBase({
      ...poseRef.current,
      cx: drag.cx + (event.clientX - drag.x) * scale,
      cy: drag.cy + (event.clientY - drag.y) * scale,
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (dragRef.current?.id === event.pointerId) dragRef.current = null;
    if (pointersRef.current.size < 2) pinchRef.current = null;
  };

  useEffect(() => {
    const box = previewRef.current;
    if (!box) return;
    const onWheelNative = (event: Event) => {
      const wheel = event as WheelEvent;
      event.preventDefault();
      if (capturingRef.current) return;
      syncBase({
        ...poseRef.current,
        viewH: poseRef.current.viewH + wheel.deltaY * 1.15,
      });
    };
    box.addEventListener("wheel", onWheelNative, { passive: false });
    return () => box.removeEventListener("wheel", onWheelNative);
  }, []);

  const capture = () => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    window.setTimeout(() => onCaptured(), 1100);
  };

  return (
    <div className="scanner-screen demo-scanner">
      <div
        className="scanner-preview"
        ref={previewRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img ref={imgRef} className="demo-scanner-desk" src={deskUrl} alt="Sample letter on a table" draggable={false} />
        <canvas ref={overlayRef} className="scan-overlay" />
        <div className="scanner-top">
          <button className="scanner-icon-btn" type="button" onClick={onClose} aria-label="Close scanner">
            ×
          </button>
          <p className="scanner-pages">Page 1</p>
          <span className="scanner-icon-btn ghost" aria-hidden="true" />
        </div>
        <p className={`scanner-guidance ${locked ? "ok" : ""}`}>{capturing ? "Saving this page…" : hint}</p>
        <p className="scanner-privacy">
          {hasMotion
            ? "Hold the phone over the letter · processed on this device"
            : "Hold the phone over the letter, or nudge the view · processed on this device"}
        </p>
        <div className="scanner-bottom">
          <span className="scanner-status">Demo</span>
          <button
            className={`scanner-shutter ${locked ? "ready" : ""}`}
            type="button"
            disabled={capturing}
            aria-label="Capture page"
            onClick={(event) => {
              event.stopPropagation();
              capture();
            }}
          />
          <span className="scanner-status">{capturing ? "Saving" : locked ? "Ready" : "Manual"}</span>
        </div>
      </div>
      {capturing && (
        <div className="scanner-saving" role="status" aria-live="assertive">
          <strong>Saving this page…</strong>
          <span>Keep this tab open. The page is being cropped and stored on this device.</span>
        </div>
      )}
    </div>
  );
}
