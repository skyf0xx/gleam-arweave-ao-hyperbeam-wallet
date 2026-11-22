/** One point on a value-over-time line chart. */
export interface ChartPoint {
  timestamp: number;
  value: number;
}

export const CHART_WIDTH = 100;
export const CHART_HEIGHT = 40;
/** Keeps the highest and lowest points off the box's edges, where half the stroke would be clipped flat. */
const CHART_INSET_Y = 3;

/**
 * Places a series in a `0..CHART_WIDTH x 0..CHART_HEIGHT` box, flat-lining
 * a single-point or zero-range series at the vertical midpoint rather than
 * dividing by zero. `bottomInset` raises the lowest point further off the
 * baseline, which leaves room for the shading under it.
 */
export function chartCoordinates(points: readonly ChartPoint[], bottomInset = CHART_INSET_Y): { x: number; y: number }[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [
      { x: 0, y: CHART_HEIGHT / 2 },
      { x: CHART_WIDTH, y: CHART_HEIGHT / 2 },
    ];
  }

  const minTimestamp = points[0]!.timestamp;
  const timeRange = points[points.length - 1]!.timestamp - minTimestamp || 1;
  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const valueRange = Math.max(...values) - minValue || 1;

  return points.map((point) => ({
    x: ((point.timestamp - minTimestamp) / timeRange) * CHART_WIDTH,
    y: CHART_HEIGHT - bottomInset - ((point.value - minValue) / valueRange) * (CHART_HEIGHT - CHART_INSET_Y - bottomInset),
  }));
}

export type ChartCoordinate = { x: number; y: number };

/** Coordinates as an SVG polyline's `points`. */
export function toPolyline(coords: readonly ChartCoordinate[]): string {
  return coords.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

/** A series as an SVG polyline's `points`. */
export function buildLinePath(points: readonly ChartPoint[]): string {
  return toPolyline(chartCoordinates(points));
}

/**
 * A monotone cubic (Fritsch–Carlson) path through the coordinates: smooth,
 * but never overshooting a peak or dip the data doesn't have.
 */
export function toSmoothPath(coords: readonly ChartCoordinate[]): string {
  const n = coords.length;
  if (n === 0) return "";
  const f = (value: number) => value.toFixed(2);
  if (n < 3) return `M${coords.map(({ x, y }) => `${f(x)} ${f(y)}`).join("L")}`;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = coords[i + 1]!.x - coords[i]!.x || 1;
    slopes.push((coords[i + 1]!.y - coords[i]!.y) / dx);
  }
  const tangents = coords.map((_, i) => {
    if (i === 0) return slopes[0]!;
    if (i === n - 1) return slopes[n - 2]!;
    const before = slopes[i - 1]!;
    const after = slopes[i]!;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  let path = `M${f(coords[0]!.x)} ${f(coords[0]!.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const { x: x0, y: y0 } = coords[i]!;
    const { x: x1, y: y1 } = coords[i + 1]!;
    const third = (x1 - x0) / 3;
    path += `C${f(x0 + third)} ${f(y0 + tangents[i]! * third)} ${f(x1 - third)} ${f(y1 - tangents[i + 1]! * third)} ${f(x1)} ${f(y1)}`;
  }
  return path;
}

/**
 * Averages a series into `maxPoints` equal buckets, keeping the last
 * point exact so the line still ends on the current value.
 */
export function downsample<T extends ChartPoint>(points: readonly T[], maxPoints: number): ChartPoint[] {
  if (points.length <= maxPoints) return [...points];
  const bucketSize = points.length / (maxPoints - 1);
  const result: ChartPoint[] = [];
  for (let bucket = 0; bucket < maxPoints - 1; bucket++) {
    const slice = points.slice(Math.floor(bucket * bucketSize), Math.floor((bucket + 1) * bucketSize));
    if (slice.length === 0) continue;
    result.push({
      timestamp: slice[0]!.timestamp,
      value: slice.reduce((sum, point) => sum + point.value, 0) / slice.length,
    });
  }
  result.push(points[points.length - 1]!);
  return result;
}
