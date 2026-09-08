export type Point = { x: number; y: number };

export type Quad = {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
};

export type DocumentMetrics = {
  areaRatio: number;
  centreOffsetX: number;
  centreOffsetY: number;
  perspectiveScore: number;
  rectangularScore: number;
  edgeCompleteness: number;
  paperLike: number;
  clipped: boolean;
};

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function orderQuad(points: Point[]): Quad {
  const sorted = [...points].sort((a, b) => a.y - b.y || a.x - b.x);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return {
    topLeft: top[0],
    topRight: top[1],
    bottomLeft: bottom[0],
    bottomRight: bottom[1],
  };
}

export function scaleQuad(quad: Quad, scaleX: number, scaleY: number): Quad {
  const map = (point: Point): Point => ({ x: point.x * scaleX, y: point.y * scaleY });
  return {
    topLeft: map(quad.topLeft),
    topRight: map(quad.topRight),
    bottomRight: map(quad.bottomRight),
    bottomLeft: map(quad.bottomLeft),
  };
}

export function lerpQuad(from: Quad, to: Quad, amount: number): Quad {
  const mix = (a: Point, b: Point): Point => ({
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  });
  return {
    topLeft: mix(from.topLeft, to.topLeft),
    topRight: mix(from.topRight, to.topRight),
    bottomRight: mix(from.bottomRight, to.bottomRight),
    bottomLeft: mix(from.bottomLeft, to.bottomLeft),
  };
}

export function quadArea(quad: Quad): number {
  const pts = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

export function quadCentroid(quad: Quad): Point {
  return {
    x: (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4,
    y: (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4,
  };
}

export function maxCornerTravel(a: Quad, b: Quad): number {
  return Math.max(
    dist(a.topLeft, b.topLeft),
    dist(a.topRight, b.topRight),
    dist(a.bottomRight, b.bottomRight),
    dist(a.bottomLeft, b.bottomLeft),
  );
}

function pairRatio(a: number, b: number): number {
  const longest = Math.max(a, b, 1);
  const shortest = Math.max(Math.min(a, b), 1);
  return shortest / longest;
}

export function analyzeQuad(quad: Quad, width: number, height: number, edgeMargin = 0.04): DocumentMetrics {
  const frameArea = Math.max(1, width * height);
  const areaRatio = quadArea(quad) / frameArea;
  const centre = quadCentroid(quad);
  const top = dist(quad.topLeft, quad.topRight);
  const bottom = dist(quad.bottomLeft, quad.bottomRight);
  const left = dist(quad.topLeft, quad.bottomLeft);
  const right = dist(quad.topRight, quad.bottomRight);
  const perspectiveScore = (pairRatio(top, bottom) + pairRatio(left, right)) / 2;
  const rectangularScore = perspectiveScore;
  const longEdge = Math.max(top, bottom, left, right);
  const shortEdge = Math.max(1, Math.min(top, bottom, left, right));
  const aspect = longEdge / shortEdge;
  const paperLike = aspect >= 1.12 && aspect <= 2.8 ? 1 : aspect >= 1.02 && aspect <= 3.6 ? 0.7 : 0.3;
  const inset = [quad.topLeft, quad.topRight, quad.bottomLeft, quad.bottomRight].map(
    (point) =>
      point.x > width * edgeMargin &&
      point.x < width * (1 - edgeMargin) &&
      point.y > height * edgeMargin &&
      point.y < height * (1 - edgeMargin),
  );
  const edgeCompleteness = inset.filter(Boolean).length / 4;
  return {
    areaRatio,
    centreOffsetX: centre.x / width - 0.5,
    centreOffsetY: centre.y / height - 0.5,
    perspectiveScore,
    rectangularScore,
    edgeCompleteness,
    paperLike,
    clipped: edgeCompleteness < 1,
  };
}

export function scoreDocumentCandidate(metrics: DocumentMetrics): number {
  const areaScore =
    metrics.areaRatio < 0.06
      ? 0
      : metrics.areaRatio > 0.995
        ? 0.2
        : metrics.areaRatio >= 0.28 && metrics.areaRatio <= 0.9
          ? 1
          : metrics.areaRatio > 0.9
            ? 0.55
            : 0.5;
  const centreScore = 1 - Math.min(1, Math.hypot(metrics.centreOffsetX, metrics.centreOffsetY) * 2.2);
  return (
    0.28 * areaScore +
    0.22 * metrics.rectangularScore +
    0.18 * metrics.paperLike +
    0.16 * metrics.edgeCompleteness +
    0.16 * centreScore
  );
}
