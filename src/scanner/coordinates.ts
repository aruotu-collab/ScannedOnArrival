export type Point = { x: number; y: number };

export type FitMode = "cover" | "contain";

export type VideoLayout = {
  videoWidth: number;
  videoHeight: number;
  displayWidth: number;
  displayHeight: number;
  renderWidth: number;
  renderHeight: number;
  offsetX: number;
  offsetY: number;
  fit: FitMode;
};

export function computeVideoLayout(
  videoWidth: number,
  videoHeight: number,
  displayWidth: number,
  displayHeight: number,
  fit: FitMode = "cover",
): VideoLayout {
  const vw = Math.max(1, videoWidth);
  const vh = Math.max(1, videoHeight);
  const dw = Math.max(1, displayWidth);
  const dh = Math.max(1, displayHeight);
  const videoAspect = vw / vh;
  const displayAspect = dw / dh;

  let renderWidth = dw;
  let renderHeight = dh;
  let offsetX = 0;
  let offsetY = 0;

  if (fit === "cover") {
    if (videoAspect > displayAspect) {
      renderHeight = dh;
      renderWidth = dh * videoAspect;
      offsetX = (dw - renderWidth) / 2;
    } else {
      renderWidth = dw;
      renderHeight = dw / videoAspect;
      offsetY = (dh - renderHeight) / 2;
    }
  } else if (videoAspect > displayAspect) {
    renderWidth = dw;
    renderHeight = dw / videoAspect;
    offsetY = (dh - renderHeight) / 2;
  } else {
    renderHeight = dh;
    renderWidth = dh * videoAspect;
    offsetX = (dw - renderWidth) / 2;
  }

  return {
    videoWidth: vw,
    videoHeight: vh,
    displayWidth: dw,
    displayHeight: dh,
    renderWidth,
    renderHeight,
    offsetX,
    offsetY,
    fit,
  };
}

export function getVideoLayout(video: HTMLVideoElement): VideoLayout {
  const fit = getComputedStyle(video).objectFit === "contain" ? "contain" : "cover";
  return computeVideoLayout(
    video.videoWidth,
    video.videoHeight,
    video.clientWidth,
    video.clientHeight,
    fit,
  );
}

export function videoPointToDisplay(point: Point, layout: VideoLayout): Point {
  return {
    x: layout.offsetX + (point.x / layout.videoWidth) * layout.renderWidth,
    y: layout.offsetY + (point.y / layout.videoHeight) * layout.renderHeight,
  };
}

export function displayPointToVideo(point: Point, layout: VideoLayout): Point {
  return {
    x: ((point.x - layout.offsetX) / layout.renderWidth) * layout.videoWidth,
    y: ((point.y - layout.offsetY) / layout.renderHeight) * layout.videoHeight,
  };
}
