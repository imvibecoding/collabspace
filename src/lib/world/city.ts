/**
 * Deterministic procedural city layout for the 3D world. Given a seed and the
 * district zones, produces the road grid, building lots (with per-district
 * scale and style), parks, trees, the river and bay, street lamps, tram
 * lines and a few recognisable Melbourne landmarks.
 *
 * Pure and seeded, so the server (planner: lot/road snapping) and the client
 * (renderer) derive an identical layout from `WorldState.citySeed` without
 * storing thousands of lots in the database.
 */
import type { WorldZone } from "./zones";


export type BuildingStyle = "tower" | "office" | "terrace" | "warehouse" | "house" | "mansion" | "apartment" | "shop";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Lot extends Rect {
  id: string;
  zoneId: string;
  style: BuildingStyle;
  /** Building height in world units (1 unit ≈ 1 m visually). */
  height: number;
  /** Facade tint. */
  color: string;
  /** Some lots get a neon sign on the street face. */
  neon: string | null;
}

export interface RoadSeg extends Rect {
  /** Horizontal (runs along x) or vertical (runs along y). */
  axis: "h" | "v";
  tram: boolean;
}

export interface Landmark extends Rect {
  id: "eureka" | "rialto" | "flinders" | "spire" | "mcg" | "fedsquare";
  name: string;
  height: number;
}

export interface CityLayout {
  size: number;
  roads: RoadSeg[];
  lots: Lot[];
  parks: Rect[];
  trees: Array<{ x: number; y: number; s: number }>;
  river: Rect[];
  bay: Rect | null;
  landmarks: Landmark[];
  lamps: Array<{ x: number; y: number }>;
}

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
}

const STYLE_COLORS: Record<BuildingStyle, string[]> = {
  tower: ["#7fa3c4", "#8fb0cc", "#6d8fb3", "#a9bcd0", "#5f7ea1"],
  office: ["#b9b4a6", "#a8a39a", "#c6c1b4", "#97928a"],
  terrace: ["#b5715a", "#c98b6b", "#9c5b48", "#d3a37f", "#8a5a4a"],
  warehouse: ["#8c8a82", "#7a776f", "#9a978c", "#6f6c64"],
  house: ["#c9b99a", "#d6c7ab", "#b8a98c", "#e0d3b8"],
  mansion: ["#e9e4d8", "#f0ece2", "#dad3c2"],
  apartment: ["#cbb6a4", "#bfa898", "#d8c7b8"],
  shop: ["#c46f5d", "#d9a066", "#7c9c8b", "#c8b06e"],
};

const NEONS = ["#ff2ea6", "#2ee6d6", "#ffb020", "#7c5cff", "#39ff14"];

/** District profile: block size, road width, lot subdivision and building scale. */
function profile(zoneId: string) {
  switch (zoneId) {
    case "central":
      return { block: 52, road: 12, lotsPer: [2, 4], hMin: 40, hMax: 210, styles: ["tower", "office", "tower", "shop"] as BuildingStyle[], park: 0.05, tree: 0.12, neon: 0.35 };
    case "north":
      return { block: 70, road: 12, lotsPer: [3, 6], hMin: 7, hMax: 16, styles: ["terrace", "terrace", "warehouse", "shop"] as BuildingStyle[], park: 0.1, tree: 0.25, neon: 0.2 };
    case "west":
      return { block: 90, road: 14, lotsPer: [1, 3], hMin: 6, hMax: 18, styles: ["warehouse", "warehouse", "shop", "terrace"] as BuildingStyle[], park: 0.06, tree: 0.08, neon: 0.08 };
    case "south":
      return { block: 80, road: 12, lotsPer: [2, 4], hMin: 8, hMax: 36, styles: ["mansion", "apartment", "house", "shop"] as BuildingStyle[], park: 0.14, tree: 0.4, neon: 0.1 };
    default:
      return { block: 76, road: 12, lotsPer: [3, 5], hMin: 6, hMax: 12, styles: ["house", "house", "house", "shop"] as BuildingStyle[], park: 0.12, tree: 0.45, neon: 0.05 };
  }
}

export function generateCity(seed: string, zones: WorldZone[], size = 1024): CityLayout {
  const rng = mulberry(hash(seed));
  const central = zones.find((z) => z.id === "central") ?? { bounds: { x: size * 0.3, y: size * 0.3, w: size * 0.4, h: size * 0.4 } };
  const cb = central.bounds;

  // --- water: the river runs along the south edge of the CBD and out to the bay in the south-west.
  const riverY = cb.y + cb.h + 6;
  const riverH = Math.round(size * 0.028);
  const bay: Rect = { x: 0, y: Math.round(size * 0.66), w: Math.round(size * 0.27), h: size - Math.round(size * 0.66) };
  const river: Rect[] = [
    { x: bay.x + bay.w - 10, y: riverY, w: size - (bay.x + bay.w - 10), h: riverH },
    { x: bay.x + bay.w - 10, y: riverY, w: 24, h: bay.y - riverY + 6 },
  ];
  const waterRects = [...river, bay];
  const isWater = (r: Rect) => waterRects.some((w) => overlaps(r, w, 4));

  // --- landmarks (south of the CBD by the river, and the MCG to the east)
  const landmarks: Landmark[] = [
    { id: "flinders", name: "Flinders Street Station", x: cb.x + cb.w * 0.36, y: riverY - 30, w: cb.w * 0.28, h: 22, height: 16 },
    { id: "fedsquare", name: "Federation Square", x: cb.x + cb.w * 0.66, y: riverY - 34, w: cb.w * 0.18, h: 26, height: 14 },
    { id: "eureka", name: "Eureka Tower", x: cb.x + cb.w * 0.4, y: riverY + riverH + 14, w: 30, h: 30, height: 297 },
    { id: "spire", name: "Arts Centre Spire", x: cb.x + cb.w * 0.28, y: riverY + riverH + 16, w: 22, h: 22, height: 162 },
    { id: "rialto", name: "Rialto Towers", x: cb.x + cb.w * 0.1, y: cb.y + cb.h * 0.5, w: 34, h: 26, height: 251 },
    { id: "mcg", name: "MCG", x: cb.x + cb.w + 60, y: cb.y + cb.h * 0.42, w: 120, h: 96, height: 34 },
  ];
  const isLandmark = (r: Rect) => landmarks.some((l) => overlaps(r, l, 8));

  // --- roads: a fine grid inside the CBD, coarser grids per district, each aligned to its own origin.
  const roads: RoadSeg[] = [];
  const parks: Rect[] = [];
  const lots: Lot[] = [];
  const trees: CityLayout["trees"] = [];
  const lamps: CityLayout["lamps"] = [];
  let lotId = 0;

  const districts = zones.length ? zones : [{ id: "central", bounds: { x: 0, y: 0, w: size, h: size } } as WorldZone];
  for (const zone of districts) {
    const p = profile(zone.id);
    const b = zone.bounds;
    const cols = Math.max(1, Math.round(b.w / p.block));
    const rows = Math.max(1, Math.round(b.h / p.block));
    const cw = b.w / cols;
    const rh = b.h / rows;
    // Roads on the grid lines (vertical then horizontal). Every 3rd CBD road and the
    // district spines carry trams.
    for (let c = 0; c <= cols; c++) {
      const x = b.x + c * cw - p.road / 2;
      roads.push({ x, y: b.y, w: p.road, h: b.h, axis: "v", tram: zone.id === "central" ? c % 3 === 1 : c === Math.floor(cols / 2) });
    }
    for (let r = 0; r <= rows; r++) {
      const y = b.y + r * rh - p.road / 2;
      roads.push({ x: b.x, y, w: b.w, h: p.road, axis: "h", tram: zone.id === "central" ? r === rows : r === Math.floor(rows / 2) });
    }
    // Blocks → parks or lots.
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const pad = p.road / 2 + 3;
        const block: Rect = { x: b.x + c * cw + pad, y: b.y + r * rh + pad, w: cw - pad * 2, h: rh - pad * 2 };
        if (block.w < 12 || block.h < 12) continue;
        if (isWater(block)) continue;
        if (isLandmark(block)) continue;
        if (rng() < p.park) {
          parks.push(block);
          const n = Math.round((block.w * block.h) / 900);
          for (let i = 0; i < n; i++) trees.push({ x: block.x + rng() * block.w, y: block.y + rng() * block.h, s: 0.8 + rng() * 0.7 });
          continue;
        }
        // Subdivide the block into lots along its longer side.
        const n = p.lotsPer[0] + Math.floor(rng() * (p.lotsPer[1] - p.lotsPer[0] + 1));
        const alongX = block.w >= block.h;
        for (let i = 0; i < n; i++) {
          const gap = 2;
          const lot: Rect = alongX
            ? { x: block.x + (block.w / n) * i + gap / 2, y: block.y, w: block.w / n - gap, h: block.h }
            : { x: block.x, y: block.y + (block.h / n) * i + gap / 2, w: block.w, h: block.h / n - gap };
          // Leave some breathing room: houses/mansions don't fill their lot.
          const style = p.styles[Math.floor(rng() * p.styles.length)];
          const inset = style === "house" || style === "mansion" ? 0.3 : style === "terrace" ? 0.08 : 0.12;
          const fw = lot.w * (1 - inset);
          const fh = lot.h * (1 - inset);
          const foot: Rect = { x: lot.x + (lot.w - fw) / 2, y: lot.y + (lot.h - fh) / 2, w: fw, h: fh };
          if (foot.w < 6 || foot.h < 6) continue;
          const t = rng();
          const height = Math.round(p.hMin + (p.hMax - p.hMin) * (zone.id === "central" ? t * t : t));
          const colors = STYLE_COLORS[style];
          lots.push({
            id: `l${lotId++}`,
            ...foot,
            zoneId: zone.id,
            style,
            height,
            color: colors[Math.floor(rng() * colors.length)],
            neon: rng() < p.neon ? NEONS[Math.floor(rng() * NEONS.length)] : null,
          });
          if ((style === "house" || style === "mansion") && rng() < p.tree) {
            trees.push({ x: lot.x + rng() * lot.w, y: lot.y + rng() * lot.h, s: 0.7 + rng() * 0.5 });
          }
        }
        // Street trees on leafy blocks.
        if (rng() < p.tree) {
          const along = Math.round(block.w / 22);
          for (let i = 0; i < along; i++) trees.push({ x: block.x + (i + 0.5) * (block.w / along), y: block.y - 2, s: 0.6 + rng() * 0.4 });
        }
        // Lamps on one corner of each block.
        lamps.push({ x: block.x - 1, y: block.y - 1 });
      }
    }
  }

  // Drop lots that ended up in water or on a landmark after subdivision.
  const cleanLots = lots.filter((l) => !isWater(l) && !isLandmark(l));
  const cleanTrees = trees.filter((t) => !isWater({ x: t.x, y: t.y, w: 1, h: 1 }));

  return { size, roads, lots: cleanLots, parks, trees: cleanTrees, river, bay, landmarks, lamps };
}

/** Rects that new entities must avoid (unless they are water/roads themselves). */
export function cityObstacles(layout: CityLayout, takenLotIds: Set<string>): Rect[] {
  return [
    ...layout.lots.filter((l) => !takenLotIds.has(l.id)),
    ...layout.landmarks,
    ...layout.river,
    ...(layout.bay ? [layout.bay] : []),
  ];
}

/** Nearest lot to a point that nobody has claimed yet. */
export function nearestFreeLot(layout: CityLayout, x: number, y: number, takenLotIds: Set<string>, zoneId?: string): Lot | null {
  let best: { lot: Lot; d: number } | null = null;
  for (const lot of layout.lots) {
    if (takenLotIds.has(lot.id)) continue;
    if (zoneId && lot.zoneId !== zoneId) continue;
    const dx = lot.x + lot.w / 2 - x;
    const dy = lot.y + lot.h / 2 - y;
    const d = dx * dx + dy * dy;
    if (!best || d < best.d) best = { lot, d };
  }
  return best?.lot ?? null;
}

/** Snap a point onto the centreline of the nearest road segment. Returns the point and the road's axis. */
export function snapToRoad(layout: CityLayout, x: number, y: number): { x: number; y: number; axis: "h" | "v" } {
  let best: { x: number; y: number; axis: "h" | "v"; d: number } | null = null;
  for (const r of layout.roads) {
    const px = Math.max(r.x, Math.min(r.x + r.w, x));
    const py = Math.max(r.y, Math.min(r.y + r.h, y));
    const sx = r.axis === "v" ? r.x + r.w / 2 : px;
    const sy = r.axis === "h" ? r.y + r.h / 2 : py;
    const d = (sx - x) ** 2 + (sy - y) ** 2;
    if (!best || d < best.d) best = { x: sx, y: sy, axis: r.axis, d };
  }
  return best ? { x: best.x, y: best.y, axis: best.axis } : { x, y, axis: "h" };
}
