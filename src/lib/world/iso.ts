/**
 * Isometric (2:1 dimetric) projection math for the world renderer.
 * Pure and framework-agnostic so the server-side base-map generator and the
 * client WorldView component share one implementation and one set of tests.
 */

export interface IsoPoint {
  x: number;
  y: number;
}

/** Project a world-space (top-down) point into isometric screen space. */
export function toIso(x: number, y: number): IsoPoint {
  return { x: x - y, y: (x + y) / 2 };
}

/** Painter's-algorithm depth: larger draws later (in front). Ties with iso screen-y. */
export function isoDepth(x: number, y: number): number {
  return x + y;
}

/** Screen-space bounds for a world of the given size — use as an SVG viewBox. */
export function isoViewBox(width: number, height: number) {
  return { minX: -height, minY: 0, width: width + height, height: (width + height) / 2 };
}

export interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 | 90 | 180 | 270 — cardinal rotation, swaps effective w/h. */
  rotation?: number;
}

/** The world-space footprint's four corners projected to iso, in draw order [back, right, front, left]. */
export function isoFootprintCorners(fp: Footprint) {
  const swapped = fp.rotation === 90 || fp.rotation === 270;
  const w = swapped ? fp.h : fp.w;
  const h = swapped ? fp.w : fp.h;
  const { x, y } = fp;
  return {
    back: toIso(x, y),
    right: toIso(x + w, y),
    front: toIso(x + w, y + h),
    left: toIso(x, y + h),
  };
}

/** Shift a projected point up on screen to represent height (elevation). */
export function raise(p: IsoPoint, height: number): IsoPoint {
  return { x: p.x, y: p.y - height };
}

export function pointsAttr(points: IsoPoint[]): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/** Darken/lighten a `#rrggbb` color by a multiplicative factor (1 = unchanged). */
export function shade(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 0xff) * factor);
  const g = clamp(((n >> 8) & 0xff) * factor);
  const b = clamp((n & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
