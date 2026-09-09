/**
 * World asset generators behind interfaces so the mock versions can be swapped
 * for real models without touching the room code:
 *   - BaseWorldGenerator: prompt → background map (later: Hunyuan3D-WorldClaw
 *     or an image model for the 2D stage)
 *   - SpriteGenerator: entity → top-down sprite (later: image model with a
 *     "top-down pixel-art sprite, transparent background" system prompt)
 */
import type { EntityKind, WorldEntity, WorldState } from "./types";
import { DEFAULT_WORLD_SIZE } from "./types";

export interface BaseWorldGenerator {
  readonly key: string;
  estimateCostCents(prompt: string): number;
  generate(prompt: string): Promise<{ backgroundUrl: string; theme: string; providerCostCents: number; provenance: Record<string, unknown> }>;
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
  { key: "city", words: ["city", "town", "urban", "downtown", "street", "metropolis", "suburb"], ground: "#8b8f86", block: "#a5a89f", road: "#4a4d4a", water: "#3b6fa3" },
];

export function pickTheme(prompt: string) {
  const t = prompt.toLowerCase();
  return THEMES.find((th) => th.words.some((w) => t.includes(w))) ?? THEMES[THEMES.length - 1];
}

/** Deterministic top-down city-block map from the prompt. Free. */
export class MockBaseWorldGenerator implements BaseWorldGenerator {
  readonly key = "mock";
  estimateCostCents() {
    return 0;
  }
  async generate(prompt: string) {
    const size = DEFAULT_WORLD_SIZE;
    const theme = pickTheme(prompt);
    const rng = mulberry(hash(prompt));
    const parts: string[] = [`<rect width="${size}" height="${size}" fill="${theme.ground}"/>`];

    // Water: a river or coastline for watery themes.
    if (theme.water && (/(river|lake|coast|island|harbou?r|bay|beach|sea|port)/.test(prompt.toLowerCase()) || theme.key === "island")) {
      if (theme.key === "island") {
        parts.push(`<rect width="${size}" height="${size}" fill="${theme.water}"/>`);
        parts.push(`<ellipse cx="${size / 2}" cy="${size / 2}" rx="${size * 0.42}" ry="${size * 0.36}" fill="${theme.ground}"/>`);
      } else {
        const x0 = Math.round(rng() * size * 0.6 + size * 0.2);
        parts.push(`<path d="M ${x0} 0 C ${x0 + 120} ${size * 0.3}, ${x0 - 160} ${size * 0.6}, ${x0 + 40} ${size} L ${x0 + 110} ${size} C ${x0 - 90} ${size * 0.6}, ${x0 + 190} ${size * 0.3}, ${x0 + 70} 0 Z" fill="${theme.water}"/>`);
      }
    }

    // Road grid with a few blocks knocked out for variety.
    const cols = 5 + Math.floor(rng() * 3);
    const rows = 5 + Math.floor(rng() * 3);
    const cw = size / cols;
    const rh = size / rows;
    const roadW = 34;
    for (let c = 0; c <= cols; c++) parts.push(`<rect x="${Math.round(c * cw - roadW / 2)}" y="0" width="${roadW}" height="${size}" fill="${theme.road}"/>`);
    for (let r = 0; r <= rows; r++) parts.push(`<rect x="0" y="${Math.round(r * rh - roadW / 2)}" width="${size}" height="${roadW}" fill="${theme.road}"/>`);
    // Lane markings
    for (let c = 0; c <= cols; c++) parts.push(`<line x1="${Math.round(c * cw)}" y1="0" x2="${Math.round(c * cw)}" y2="${size}" stroke="#f2e28a" stroke-width="2" stroke-dasharray="14 18" opacity="0.8"/>`);
    for (let r = 0; r <= rows; r++) parts.push(`<line x1="0" y1="${Math.round(r * rh)}" x2="${size}" y2="${Math.round(r * rh)}" stroke="#f2e28a" stroke-width="2" stroke-dasharray="14 18" opacity="0.8"/>`);
    // Blocks
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rng() < 0.18) continue; // park / empty lot
        const pad = roadW / 2 + 6;
        const x = Math.round(c * cw + pad);
        const y = Math.round(r * rh + pad);
        const w = Math.round(cw - pad * 2);
        const h = Math.round(rh - pad * 2);
        const shade = 0.85 + rng() * 0.3;
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${theme.block}" opacity="${shade.toFixed(2)}" rx="3"/>`);
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join("")}</svg>`;
    return { backgroundUrl: svgUrl(svg), theme: theme.key, providerCostCents: 0, provenance: { kind: "mock-map", prompt } };
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
  black: "#222", white: "#f4f4f4", grey: "#9a9a9a", brown: "#8b5a2b", gold: "#d4af37", silver: "#c0c0c0", neon: "#39ff14", cyan: "#2ee6d6", magenta: "#ff2ea6",
};

export function entityFill(e: Pick<WorldEntity, "kind" | "color">) {
  return (e.color && NAMED_COLORS[e.color]) || KIND_COLORS[e.kind];
}

/** Simple top-down glyphs per kind. Free. */
export class MockSpriteGenerator implements SpriteGenerator {
  readonly key = "mock";
  estimateCostCents() {
    return 0;
  }
  async generate(e: WorldEntity) {
    const fill = entityFill(e);
    const w = e.w;
    const h = e.h;
    let body: string;
    switch (e.kind) {
      case "vehicle":
        body = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="5" fill="${fill}" stroke="#222" stroke-width="2"/><rect x="${w * 0.3}" y="3" width="${w * 0.35}" height="${h - 6}" fill="#222" opacity="0.6"/><circle cx="${w - 5}" cy="5" r="2" fill="#fff5b0"/><circle cx="${w - 5}" cy="${h - 5}" r="2" fill="#fff5b0"/>`;
        break;
      case "tree":
        body = `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 1}" fill="${fill}" stroke="#1f5a22" stroke-width="2"/><circle cx="${w * 0.4}" cy="${h * 0.4}" r="${w / 5}" fill="#5cb85c" opacity="0.7"/>`;
        break;
      case "character":
        body = `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 1}" fill="${fill}" stroke="#222" stroke-width="2"/><circle cx="${w / 2}" cy="${h / 2}" r="${w / 5}" fill="#5a3b2e"/>`;
        break;
      case "animal":
        body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 1}" ry="${h / 3}" fill="${fill}" stroke="#222" stroke-width="2"/><circle cx="${w * 0.8}" cy="${h / 2}" r="${h / 5}" fill="${fill}" stroke="#222" stroke-width="1.5"/>`;
        break;
      case "water":
        body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 1}" ry="${h / 2 - 1}" fill="${fill}" stroke="#1d5f8a" stroke-width="2"/><path d="M ${w * 0.25} ${h * 0.5} q ${w * 0.08} -6 ${w * 0.16} 0 t ${w * 0.16} 0 t ${w * 0.16} 0" stroke="#bfe6ff" stroke-width="2" fill="none"/>`;
        break;
      case "road":
        body = `<rect width="${w}" height="${h}" fill="${fill}"/><line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="#f2e28a" stroke-width="2" stroke-dasharray="10 12"/>`;
        break;
      case "sign":
        body = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="${fill}" stroke="#222" stroke-width="2"/><text x="${w / 2}" y="${h / 2 + 4}" font-size="${Math.max(8, h * 0.5)}" text-anchor="middle" font-family="sans-serif" fill="#222">!</text>`;
        break;
      case "scene":
        body = `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 2}" fill="${fill}" opacity="0.35"/><circle cx="${w / 2}" cy="${h / 2}" r="${w / 4}" fill="${fill}" opacity="0.6"/>`;
        break;
      case "prop":
        body = `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="${fill}" stroke="#222" stroke-width="2" rx="3"/>`;
        break;
      default: // building
        body = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="${fill}" stroke="#3a2416" stroke-width="3"/><rect x="${w * 0.15}" y="${h * 0.15}" width="${w * 0.7}" height="${h * 0.7}" fill="none" stroke="#3a2416" stroke-width="1.5" opacity="0.6"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
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
