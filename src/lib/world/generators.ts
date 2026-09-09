/**
 * World asset generators behind interfaces so the mock versions can be swapped
 * for real models without touching the room code:
 *   - BaseWorldGenerator: prompt (+ optional zones) → an isometric background
 *     map (later: an image model, or a real 3D generator once one exists with
 *     a usable API — see docs/world-room-design.md on WorldClaw's status)
 *   - SpriteGenerator: entity → a texture/color identity, used as a swatch
 *     (the isometric shape itself is drawn procedurally by WorldView so it
 *     always renders correctly at any size/rotation/height)
 */
import { isoFootprintCorners, isoViewBox, pointsAttr, shade } from "./iso";
import type { EntityKind, WorldEntity, WorldState } from "./types";
import { DEFAULT_WORLD_SIZE } from "./types";
import { zoneAt, type WorldZone } from "./zones";

export interface BaseWorldGenerator {
  readonly key: string;
  estimateCostCents(prompt: string): number;
  generate(
    prompt: string,
    zones?: WorldZone[],
  ): Promise<{ backgroundUrl: string; theme: string; providerCostCents: number; provenance: Record<string, unknown> }>;
}

export interface SpriteGenerator {
  readonly key: string;
  estimateCostCents(entity: WorldEntity): number;
  generate(entity: WorldEntity, world: WorldState): Promise<{ spriteUrl: string; providerCostCents: number }>;
}

function svgUrl(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
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

const THEMES: Array<{ key: string; words: string[]; ground: string; block: string; road: string; water: string | null }> = [
  { key: "desert", words: ["desert", "sand", "dune", "canyon", "mesa", "wasteland"], ground: "#d9b775", block: "#c9a25e", road: "#8a7350", water: null },
  { key: "snow", words: ["snow", "arctic", "ice", "frozen", "winter", "tundra"], ground: "#e8eef3", block: "#cfd8e0", road: "#8c98a3", water: "#9ec3e6" },
  { key: "forest", words: ["forest", "jungle", "woods", "village", "countryside", "farm", "rural"], ground: "#5f8f4a", block: "#4c7a3a", road: "#8f7d5a", water: "#3f79b8" },
  { key: "island", words: ["island", "beach", "coast", "tropical", "harbour", "harbor", "port", "bay"], ground: "#d8c894", block: "#7fae63", road: "#7d7a6d", water: "#2f8fc9" },
  { key: "neon", words: ["neon", "cyber", "cyberpunk", "future", "futuristic", "night", "tokyo", "synth"], ground: "#1b1d2a", block: "#2a2d45", road: "#3c4160", water: "#1e4c6e" },
  { key: "city", words: ["city", "town", "urban", "downtown", "street", "metropolis", "suburb", "melbourne"], ground: "#8b8f86", block: "#a5a89f", road: "#4a4d4a", water: "#3b6fa3" },
];

export function pickTheme(prompt: string) {
  const t = prompt.toLowerCase();
  return THEMES.find((th) => th.words.some((w) => t.includes(w))) ?? THEMES[THEMES.length - 1];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isoDiamond(fp: Rect, fill: string, opacity = 1): string {
  const c = isoFootprintCorners(fp);
  return `<polygon points="${pointsAttr([c.back, c.right, c.front, c.left])}" fill="${fill}" opacity="${opacity}"/>`;
}

/** Deterministic isometric city-block map from the prompt. Free. */
export class MockBaseWorldGenerator implements BaseWorldGenerator {
  readonly key = "mock";
  estimateCostCents() {
    return 0;
  }
  async generate(prompt: string, zones: WorldZone[] = []) {
    const size = DEFAULT_WORLD_SIZE;
    const theme = pickTheme(prompt);
    const rng = mulberry(hash(prompt));
    const vb = isoViewBox(size, size);
    const parts: string[] = [];

    // Whole-world ground.
    parts.push(isoDiamond({ x: 0, y: 0, w: size, h: size }, theme.ground));

    // District tinting (city worlds only) — each zone gets a soft wash so
    // its character reads before anyone's placed anything in it.
    for (const zone of zones) parts.push(isoDiamond(zone.bounds, zone.color, 0.5));

    // Water: a river/coastline for watery themes, or a stylised river through
    // a city layout (a nod to the Yarra, without claiming to be it).
    const wantsWater = theme.water && /river|lake|coast|island|harbou?r|bay|beach|sea|port/.test(prompt.toLowerCase());
    if (zones.length > 0) {
      parts.push(isoDiamond({ x: 0, y: size * 0.58, w: size, h: size * 0.045 }, "#2f6fa0", 0.85));
    } else if (theme.water && (wantsWater || theme.key === "island")) {
      if (theme.key === "island") {
        parts.push(isoDiamond({ x: 0, y: 0, w: size, h: size }, theme.water));
        parts.push(isoDiamond({ x: size * 0.08, y: size * 0.08, w: size * 0.84, h: size * 0.84 }, theme.ground));
      } else {
        const x0 = size * 0.35 + rng() * size * 0.2;
        parts.push(isoDiamond({ x: x0, y: 0, w: size * 0.12, h: size }, theme.water));
      }
    }

    // Road grid.
    const cols = 5 + Math.floor(rng() * 3);
    const rows = 5 + Math.floor(rng() * 3);
    const cw = size / cols;
    const rh = size / rows;
    const roadW = 30;
    for (let c = 0; c <= cols; c++) parts.push(isoDiamond({ x: c * cw - roadW / 2, y: 0, w: roadW, h: size }, theme.road, 0.9));
    for (let r = 0; r <= rows; r++) parts.push(isoDiamond({ x: 0, y: r * rh - roadW / 2, w: size, h: roadW }, theme.road, 0.9));

    // Blocks — tinted per zone when the world has districts, so West already
    // reads grittier and South already reads glossier before anyone submits.
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rng() < 0.18) continue; // park / empty lot
        const pad = roadW / 2 + 6;
        const x = c * cw + pad;
        const y = r * rh + pad;
        const w = cw - pad * 2;
        const h = rh - pad * 2;
        const zone = zones.length ? zoneAt(zones, x + w / 2, y + h / 2) : null;
        const fill = zone ? shade(zone.color, 1.2) : theme.block;
        const opacity = 0.55 + rng() * 0.25;
        parts.push(isoDiamond({ x, y, w, h }, fill, opacity));
      }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.minX} ${vb.minY} ${vb.width} ${vb.height}" width="${vb.width}" height="${vb.height}">${parts.join("")}</svg>`;
    return {
      backgroundUrl: svgUrl(svg),
      theme: theme.key,
      providerCostCents: 0,
      provenance: { kind: "mock-map-iso", prompt, zones: zones.map((z) => z.id) },
    };
  }
}

const KIND_COLORS: Record<EntityKind, string> = {
  building: "#b6663f",
  road: "#4a4d4a",
  tree: "#2f7d32",
  water: "#2f8fc9",
  vehicle: "#d64545",
  character: "#f2c27b",
  animal: "#a67c52",
  prop: "#8d8d8d",
  sign: "#f2d24b",
  scene: "#ff8c42",
};

const NAMED_COLORS: Record<string, string> = {
  red: "#d64545", blue: "#3b6fd1", green: "#3aa655", yellow: "#f2d24b", orange: "#ff8c42", purple: "#8e5bd6", pink: "#ec6fb0",
  black: "#222222", white: "#f4f4f4", grey: "#9a9a9a", brown: "#8b5a2b", gold: "#d4af37", silver: "#c0c0c0", neon: "#39ff14", cyan: "#2ee6d6", magenta: "#ff2ea6",
};

export function entityFill(e: Pick<WorldEntity, "kind" | "color">) {
  return (e.color && NAMED_COLORS[e.color]) || KIND_COLORS[e.kind];
}

/**
 * Color/texture identity per entity. Kept for cost-accounting and as the seam
 * for a real image model later; the isometric *shape* is drawn procedurally
 * by WorldView (src/components/world-view.tsx), not from this bitmap, so it
 * always looks correct at any size, rotation or elevation.
 */
export class MockSpriteGenerator implements SpriteGenerator {
  readonly key = "mock";
  estimateCostCents() {
    return 0;
  }
  async generate(e: WorldEntity) {
    const fill = entityFill(e);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/></svg>`;
    return { spriteUrl: svgUrl(svg), providerCostCents: 0 };
  }
}

const baseRegistry: Record<string, () => BaseWorldGenerator> = { mock: () => new MockBaseWorldGenerator() };
const spriteRegistry: Record<string, () => SpriteGenerator> = { mock: () => new MockSpriteGenerator() };

export function getBaseWorldGenerator(key?: string | null): BaseWorldGenerator {
  return (baseRegistry[key ?? ""] ?? baseRegistry[process.env.WORLD_GENERATOR_DEFAULT ?? "mock"] ?? baseRegistry.mock)();
}
export function getSpriteGenerator(key?: string | null): SpriteGenerator {
  return (spriteRegistry[key ?? ""] ?? spriteRegistry[process.env.SPRITE_GENERATOR_DEFAULT ?? "mock"] ?? spriteRegistry.mock)();
}
