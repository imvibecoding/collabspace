/**
 * Real-world base maps, extracted from OpenStreetMap into a committed asset by
 * `scripts/build-basemap.mjs` (see that file for the query and simplification).
 *
 * The base map is an *outline*, deliberately not a full city: water, coast,
 * parks, major roads and a handful of hand-modelled landmarks. Everything else
 * in a world comes from what people prompt in.
 *
 * Data © OpenStreetMap contributors, ODbL.
 */
import melbourne from "./basemap-melbourne.json";

/** Polygons/polylines are flat [x0,y0,x1,y1,…] in world units to keep the asset small. */
export type Flat = number[];

export interface BaseMapLandmark {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Real height in metres. */
  height: number;
}

export interface BaseMap {
  source: string;
  attribution: string;
  built: string;
  size: number;
  /** [south, west, north, east] */
  bbox: number[];
  water: Flat[];
  coast: Flat[];
  /** The bay, already closed into a fillable ring. */
  sea: Flat;
  green: Flat[];
  roads: Array<{ w: number; pts: Flat }>;
  landmarks: BaseMapLandmark[];
}

export const BASE_MAPS = { melbourne: melbourne as BaseMap } as const;
export type BaseMapId = keyof typeof BASE_MAPS;

export function getBaseMap(id: string | null | undefined): BaseMap | null {
  if (!id) return null;
  return (BASE_MAPS as Record<string, BaseMap | undefined>)[id] ?? null;
}

/**
 * Buildings are metres tall but the map spans ~21 km across 1024 units, so a
 * 300 m tower is only ~15 units. Exaggerate the vertical a little — standard
 * practice for city views — so skyline still reads when zoomed out.
 */
export const VERTICAL_EXAGGERATION = 3.6;

/** Metres per world unit for a base map (from its bbox). */
export function metresPerUnit(bm: BaseMap): number {
  const [south, , north] = bm.bbox;
  return ((north - south) * 110574) / bm.size;
}

/** Convert a real height in metres to the renderer's vertical units. */
export function heightUnits(bm: BaseMap, metres: number): number {
  return (metres / metresPerUnit(bm)) * VERTICAL_EXAGGERATION;
}

/**
 * Footprints and heights for things people prompt in, in world units, for a
 * real base map (~20 m per unit). Deliberately not to scale: a real car is a
 * fifth of a unit and would be invisible, so small things are exaggerated
 * enough to see once you zoom into a district, while buildings stay roughly
 * believable against the landmarks.
 */
export const BASEMAP_ENTITY_SIZE: Record<string, { w: number; h: number; height: number }> = {
  building: { w: 7, h: 7, height: 14 },
  road: { w: 26, h: 3.5, height: 0 },
  tree: { w: 2.4, h: 2.4, height: 3 },
  water: { w: 14, h: 10, height: 0 },
  vehicle: { w: 3.2, h: 1.7, height: 1.4 },
  character: { w: 1.6, h: 1.6, height: 2 },
  animal: { w: 1.6, h: 1.6, height: 1.4 },
  prop: { w: 2.2, h: 2.2, height: 2 },
  sign: { w: 2.6, h: 1.2, height: 3 },
  scene: { w: 14, h: 14, height: 4 },
};

/* ----------------------------- geometry ---------------------------------- */

export function pointInRing(x: number, y: number, ring: Flat): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const yi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const yj = ring[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Is this point in the bay, the river or a lake? */
export function inWater(bm: BaseMap, x: number, y: number): boolean {
  if (bm.sea.length && pointInRing(x, y, bm.sea)) return true;
  return bm.water.some((w) => pointInRing(x, y, w));
}

/** Would this footprint sit in water? Samples the centre and corners. */
export function rectInWater(bm: BaseMap, r: { x: number; y: number; w: number; h: number }): boolean {
  const pts: Array<[number, number]> = [
    [r.x + r.w / 2, r.y + r.h / 2],
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ];
  return pts.some(([x, y]) => inWater(bm, x, y));
}

export function landmarkRects(bm: BaseMap, pad = 4) {
  return bm.landmarks.map((l) => ({ x: l.x - pad, y: l.y - pad, w: l.w + pad * 2, h: l.h + pad * 2 }));
}

/** Nearest point on any major road, with the road's local heading in degrees. */
export function nearestRoad(bm: BaseMap, x: number, y: number): { x: number; y: number; angle: number } | null {
  let best: { x: number; y: number; angle: number; d: number } | null = null;
  for (const road of bm.roads) {
    const n = road.pts.length / 2;
    for (let i = 1; i < n; i++) {
      const ax = road.pts[(i - 1) * 2];
      const ay = road.pts[(i - 1) * 2 + 1];
      const bx = road.pts[i * 2];
      const by = road.pts[i * 2 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const px = ax + t * dx;
      const py = ay + t * dy;
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (!best || d < best.d) best = { x: px, y: py, angle: (Math.atan2(dy, dx) * 180) / Math.PI, d };
    }
  }
  return best ? { x: best.x, y: best.y, angle: best.angle } : null;
}

/** Is this point inside a park or reserve? Used to keep buildings off the green. */
export function inGreen(bm: BaseMap, x: number, y: number): boolean {
  return bm.green.some((g) => pointInRing(x, y, g));
}
