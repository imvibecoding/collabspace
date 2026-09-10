/**
 * World planner: turns a free-text prompt into a structured WorldPatch.
 *
 * `HeuristicPlanner` is a zero-cost rule-based interpreter good enough to
 * exercise the whole system. `WorldPlanner` is the seam for an LLM planner
 * later (same input/output contract), so rooms never change when we swap it.
 */
import { rectsOverlap } from "./patch";
import { DEFAULT_HEIGHT_BY_KIND } from "./types";
import type { EntityKind, WorldEntity, WorldOp, WorldPatch, WorldState } from "./types";
import { detectZoneByAlias, deriveZoneStyle, zoneForPrompt, zoneHint, type WorldZone } from "./zones";
import { cityObstacles, generateCity, nearestFreeLot, snapToRoad, type CityLayout, type Rect } from "./city";
import { BASEMAP_ENTITY_SIZE, getBaseMap, inGreen, landmarkRects, nearestRoad, rectInWater, type BaseMap } from "./basemap";

export interface PlanContext {
  state: WorldState;
  /** Deterministic randomness for tests. Returns [0,1). */
  rng?: () => number;
  /** Id factory (defaults to random). */
  newId?: () => string;
}

export interface WorldPlanner {
  plan(prompt: string, ctx: PlanContext): Promise<WorldPatch>;
}

/* ----------------------------- vocab -------------------------------------- */

const KIND_WORDS: Array<[EntityKind, string[], { w: number; h: number }]> = [
  ["building", ["building", "house", "tower", "shop", "store", "bank", "cafe", "café", "hotel", "office", "skyscraper", "church", "school", "hospital", "station", "warehouse", "garage", "stadium", "castle", "hut", "cabin", "apartment", "mall", "diner", "bar", "club", "temple", "factory"], { w: 96, h: 96 }],
  ["road", ["road", "street", "highway", "bridge", "path", "lane", "avenue", "railway", "track", "runway"], { w: 240, h: 40 }],
  ["tree", ["tree", "trees", "oak", "pine", "palm", "forest", "bush", "hedge", "cactus", "flower", "flowers", "garden"], { w: 40, h: 40 }],
  ["water", ["lake", "pond", "river", "pool", "fountain", "sea", "ocean", "harbour", "harbor", "canal"], { w: 160, h: 120 }],
  ["vehicle", ["car", "cars", "truck", "bus", "taxi", "van", "bike", "motorbike", "motorcycle", "boat", "ship", "helicopter", "plane", "tank", "tram", "train", "ambulance", "police car", "fire truck", "limo", "sports car", "scooter"], { w: 44, h: 24 }],
  ["character", ["person", "people", "man", "woman", "kid", "child", "cop", "police", "officer", "robber", "thief", "zombie", "gangster", "hero", "villain", "wizard", "knight", "pedestrian", "crowd", "tourist", "chef", "ninja", "pirate", "alien", "robot", "soldier"], { w: 18, h: 18 }],
  ["animal", ["dog", "cat", "horse", "cow", "sheep", "bird", "pigeon", "duck", "dragon", "dinosaur", "shark", "whale", "goat", "pig", "chicken", "elephant", "lion", "bear"], { w: 24, h: 24 }],
  ["sign", ["sign", "billboard", "banner", "graffiti", "poster", "flag", "statue", "monument"], { w: 40, h: 24 }],
  ["prop", ["bench", "lamp", "streetlight", "crate", "barrel", "dumpster", "hydrant", "tent", "stall", "market", "table", "chair", "rock", "boulder", "fence", "wall", "crater", "portal", "ufo", "bomb", "treasure", "chest", "box"], { w: 28, h: 28 }],
  ["scene", ["party", "festival", "parade", "concert", "fire", "explosion", "riot", "protest", "wedding", "race", "chase", "battle", "storm", "flood", "snow", "fog"], { w: 140, h: 140 }],
];

const COLORS = ["red", "blue", "green", "yellow", "orange", "purple", "pink", "black", "white", "grey", "gray", "brown", "gold", "silver", "neon", "cyan", "magenta"];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12, some: 3, few: 3, several: 4, many: 6, lots: 8 };
const MAX_COUNT = 12;

const REMOVE_VERBS = ["remove", "delete", "destroy", "demolish", "erase", "clear", "nuke", "get rid of", "take away", "kill"];
const MOVE_VERBS = ["move", "relocate", "shift", "push", "drag", "drive", "send"];
const MODIFY_VERBS = ["paint", "recolor", "recolour", "color", "colour", "rename", "make", "turn", "enlarge", "shrink", "grow", "resize", "upgrade", "change"];
const ADD_VERBS = ["add", "place", "put", "spawn", "build", "plant", "park", "drop", "create", "install", "erect", "open", "start", "throw"];

const REGIONS: Record<string, [number, number]> = {
  "top left": [0.15, 0.15], "top right": [0.85, 0.15], "bottom left": [0.15, 0.85], "bottom right": [0.85, 0.85],
  "north west": [0.15, 0.15], "north east": [0.85, 0.15], "south west": [0.15, 0.85], "south east": [0.85, 0.85],
  northwest: [0.15, 0.15], northeast: [0.85, 0.15], southwest: [0.15, 0.85], southeast: [0.85, 0.85],
  north: [0.5, 0.12], south: [0.5, 0.88], east: [0.88, 0.5], west: [0.12, 0.5],
  top: [0.5, 0.12], bottom: [0.5, 0.88], left: [0.12, 0.5], right: [0.88, 0.5],
  center: [0.5, 0.5], centre: [0.5, 0.5], middle: [0.5, 0.5], downtown: [0.5, 0.5], edge: [0.05, 0.5], corner: [0.9, 0.9],
};

/* ----------------------------- helpers ------------------------------------ */

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function detectKind(text: string): { kind: EntityKind; word: string; size: { w: number; h: number } } | null {
  let best: { kind: EntityKind; word: string; size: { w: number; h: number }; idx: number } | null = null;
  for (const [kind, words, size] of KIND_WORDS) {
    for (const w of words) {
      const re = new RegExp(`\\b${w}s?\\b`);
      const m = re.exec(text);
      if (m && (best === null || m.index < best.idx)) best = { kind, word: w, size, idx: m.index };
    }
  }
  return best;
}

function detectCount(text: string, kindWord: string): number {
  const m = new RegExp(`\\b(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:[a-z]+\\s+){0,2}${kindWord}`).exec(text);
  if (!m) return /\b(bunch|group|crowd|forest|fleet|herd|flock)\b/.test(text) ? 5 : 1;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  return Math.max(1, Math.min(MAX_COUNT, n || 1));
}

function detectColor(text: string): string | null {
  for (const c of COLORS) if (new RegExp(`\\b${c}\\b`).test(text)) return c === "gray" ? "grey" : c;
  return null;
}

function detectRegion(text: string): [number, number] | null {
  const keys = Object.keys(REGIONS).sort((a, b) => b.length - a.length);
  for (const k of keys) if (new RegExp(`\\b${k}\\b`).test(text)) return REGIONS[k];
  const coord = /\b(?:at|to)\s+(\d{1,4})\s*[, ]\s*(\d{1,4})\b/.exec(text);
  if (coord) return [Number(coord[1]) / 1024, Number(coord[2]) / 1024];
  return null;
}

/**
 * Resolve where a prompt should land. Zone place names win first ("build a
 * bank in Toorak"), then generic direction words, then, for allowImplicit
 * callers only (new placements, not moves), a zone whose theme matches the
 * prompt even when no place is named, so "typical of the area" content
 * clusters there without anyone having to ask for it explicitly.
 */
function resolveRegion(
  text: string,
  state: WorldState,
  allowImplicit: boolean,
): { hint: [number, number] | null; zone: WorldZone | null } {
  const zones = state.zones ?? [];
  if (zones.length) {
    const explicit = detectZoneByAlias(text, zones);
    if (explicit) return { hint: zoneHint(explicit, state.width), zone: explicit };
  }
  const generic = detectRegion(text);
  if (generic) return { hint: generic, zone: null };
  if (allowImplicit && zones.length) {
    const implicit = zoneForPrompt(text, zones);
    if (implicit) return { hint: zoneHint(implicit, state.width), zone: implicit };
  }
  return { hint: null, zone: null };
}

/**
 * "make the west look like a rainy port" / "turn Footscray into a slum" —
 * a whole-district restyle rather than a single object. Exported so pricing can
 * spot one before the planner runs.
 */
export function detectZoneTheme(prompt: string, zones: WorldZone[]): { zone: WorldZone; description: string } | null {
  if (!zones.length) return null;
  const text = norm(prompt);
  const m =
    /\b(?:make|turn|render|restyle|redo|convert)\b\s+(.+?)\s+(?:look\s+like|look|into|to look like|like|as)\s+(.+)$/.exec(text) ??
    /\b(?:make|turn)\b\s+(.+?)\s+(more\s+.+)$/.exec(text);
  if (!m) return null;
  const zone = detectZoneByAlias(m[1], zones);
  if (!zone) return null;
  const description = m[2].replace(/^(a|an|the)\s+/, "").trim();
  if (!description) return null;
  return { zone, description };
}

/** Find an existing entity referred to in the text ("the red car", "the bank"). */
function findReferenced(text: string, state: WorldState, exclude?: string): WorldEntity | null {
  const words = text.split(" ");
  const candidates = state.entities
    .filter((e) => e.id !== exclude)
    .map((e) => {
      const nameWords = norm(e.name).split(" ");
      const hits = nameWords.filter((w) => words.includes(w) || words.includes(w + "s") || (w.endsWith("s") && words.includes(w.slice(0, -1)))).length;
      const kindHit = words.includes(e.kind) ? 0.5 : 0;
      return { e, score: hits + kindHit };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.e ?? null;
}

function nameFor(text: string, kindWord: string, color: string | null): string {
  // Take up to two descriptive words immediately before the kind word, plus the kind word.
  const m = new RegExp(`((?:[a-z]+\\s+){0,2})${kindWord}s?\\b`).exec(text);
  const pre = (m?.[1] ?? "")
    .trim()
    .split(" ")
    .filter((w) => w && !NUMBER_WORDS[w] && !/^\d+$/.test(w) && !["the", "of", "and", "with", "near", "next", "to", "a", "an", "some"].includes(w) && !ADD_VERBS.includes(w));
  const words = [...pre.slice(-2), kindWord];
  if (color && !words.includes(color)) words.unshift(color);
  return words.join(" ");
}

function freeSpot(
  state: WorldState,
  w: number,
  h: number,
  hint: [number, number] | null,
  rng: () => number,
  obstacles: Rect[] = [],
  opts: { bm?: BaseMap | null; allowWater?: boolean; avoidGreen?: boolean } = {},
): { x: number; y: number } {
  const W = state.width;
  const H = state.height;
  const bm = opts.bm ?? null;
  let fallback: { x: number; y: number } | null = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const spread = hint ? 0.12 + attempt * 0.01 : 1;
    const cx = hint ? hint[0] * W + (rng() - 0.5) * spread * W : rng() * W;
    const cy = hint ? hint[1] * H + (rng() - 0.5) * spread * H : rng() * H;
    const x = Math.round(Math.min(W - w, Math.max(0, cx - w / 2)));
    const y = Math.round(Math.min(H - h, Math.max(0, cy - h / 2)));
    const rect = { x, y, w, h };
    // Anything on dry land is a valid last resort, even if it's crowded.
    if (!fallback && (!bm || opts.allowWater || !rectInWater(bm, rect))) fallback = { x, y };
    if (state.entities.some((e) => e.kind !== "road" && e.kind !== "water" && rectsOverlap(e, rect))) continue;
    if (obstacles.some((o) => rectsOverlap(o, rect, 2))) continue;
    if (bm && !opts.allowWater && rectInWater(bm, rect)) continue;
    if (bm && opts.avoidGreen && inGreen(bm, x + w / 2, y + h / 2)) continue;
    return { x, y };
  }
  return fallback ?? { x: Math.round(rng() * (W - w)), y: Math.round(rng() * (H - h)) };
}

function nearSpot(
  anchor: WorldEntity,
  w: number,
  h: number,
  state: WorldState,
  rng: () => number,
  obstacles: Rect[] = [],
  opts: { bm?: BaseMap | null; allowWater?: boolean; avoidGreen?: boolean } = {},
) {
  const hint: [number, number] = [(anchor.x + anchor.w / 2) / state.width, (anchor.y + anchor.h / 2) / state.height];
  return freeSpot(state, w, h, hint, rng, obstacles, opts);
}

/** City worlds carry a procedural layout; new things must fit around it (or claim a lot / a road). */
function cityContext(state: WorldState): { layout: CityLayout; taken: Set<string> } | null {
  if (!state.citySeed) return null;
  const layout = generateCity(state.citySeed, state.zones ?? [], state.width);
  const taken = new Set(state.entities.map((e) => (e.meta as { lotId?: string }).lotId).filter((v): v is string => Boolean(v)));
  return { layout, taken };
}

/* ----------------------------- planner ------------------------------------ */

export class HeuristicPlanner implements WorldPlanner {
  async plan(prompt: string, ctx: PlanContext): Promise<WorldPatch> {
    const text = norm(prompt);
    const rng = ctx.rng ?? Math.random;
    const newId = ctx.newId ?? (() => Math.random().toString(36).slice(2, 10));
    const state = ctx.state;
    const has = (verbs: string[]) => verbs.some((v) => new RegExp(`\\b${v}\\b`).test(text));

    // --- theme a whole district ---
    const theme = detectZoneTheme(prompt, state.zones ?? []);
    if (theme) {
      const style = deriveZoneStyle(theme.description);
      return {
        ops: [{ op: "zone", zoneId: theme.zone.id, style }],
        summary: `restyled the ${theme.zone.name} as ${style.label}`,
      };
    }

    // --- remove ---
    if (has(REMOVE_VERBS)) {
      const target = findReferenced(text, state);
      if (!target) throw new PlanError("Couldn't find anything matching that to remove");
      const all = /\ball\b/.test(text);
      const targets = all ? state.entities.filter((e) => e.kind === target.kind) : [target];
      return {
        ops: targets.map((e) => ({ op: "remove", id: e.id })),
        summary: all ? `removed all ${target.kind}s` : `removed the ${target.name}`,
      };
    }

    // --- move ---
    if (has(MOVE_VERBS)) {
      const target = findReferenced(text, state);
      if (!target) throw new PlanError("Couldn't find anything matching that to move");
      const { hint: region, zone } = resolveRegion(text, state, false);
      const afterTo = text.split(/\b(?:to|near|next to|beside|by)\b/)[1] ?? "";
      const anchor = afterTo ? findReferenced(afterTo, state, target.id) : null;
      const bmM = getBaseMap(state.baseMapId);
      const cityM = bmM ? null : cityContext(state);
      const solidM = target.kind !== "road" && target.kind !== "water";
      const obstaclesM = cityM && solidM ? cityObstacles(cityM.layout, cityM.taken) : solidM && bmM ? landmarkRects(bmM) : [];
      const optsM = { bm: bmM, allowWater: !solidM };
      const spot = anchor
        ? nearSpot(anchor, target.w, target.h, state, rng, obstaclesM, optsM)
        : freeSpot(state, target.w, target.h, region, rng, obstaclesM, optsM);
      return {
        ops: [{ op: "move", id: target.id, x: spot.x, y: spot.y }],
        summary: `moved the ${target.name}${anchor ? ` next to the ${anchor.name}` : zone ? ` to the ${zone.name}` : region ? " across the map" : ""}`,
      };
    }

    // --- modify (only when the prompt clearly targets an existing entity) ---
    if (has(MODIFY_VERBS)) {
      const target = findReferenced(text, state);
      if (target) {
        const changes: Extract<WorldOp, { op: "modify" }>["changes"] = {};
        const color = detectColor(text);
        if (color) changes.color = color;
        if (/\b(bigger|larger|huge|giant|enlarge|grow)\b/.test(text)) {
          changes.w = Math.round(target.w * 1.6);
          changes.h = Math.round(target.h * 1.6);
        }
        if (/\b(smaller|tiny|shrink|mini)\b/.test(text)) {
          changes.w = Math.max(8, Math.round(target.w * 0.6));
          changes.h = Math.max(8, Math.round(target.h * 0.6));
        }
        const rename = /\b(?:rename|call)\s+(?:the\s+)?[a-z ]+?\s+(?:to|as)\s+([a-z ]+)$/.exec(text);
        if (rename) changes.name = rename[1].trim();
        if (color && !changes.name) changes.name = target.name.replace(new RegExp(`\\b(${COLORS.join("|")})\\b`), "").replace(/\s+/g, " ").trim();
        if (color && changes.name) changes.name = `${color} ${changes.name}`.trim();
        if (Object.keys(changes).length === 0) throw new PlanError("Tell me what to change (colour, size or name)");
        return { ops: [{ op: "modify", id: target.id, changes }], summary: `changed the ${target.name}` };
      }
    }

    // --- add (default) ---
    const detected = detectKind(text);
    if (!detected) throw new PlanError("Couldn't tell what to add. Try naming a thing: a car, a shop, three trees…");
    const count = detectCount(text, detected.word);
    const color = detectColor(text);
    const { hint: region, zone } = resolveRegion(text, state, true);
    const afterNear = text.split(/\b(?:near|next to|beside|by|around|behind|in front of|outside|at)\b/)[1] ?? "";
    const anchor = afterNear ? findReferenced(afterNear, state) : null;
    const name = nameFor(text, detected.word, color);
    const ops: WorldOp[] = [];
    let working = state;
    const bm = getBaseMap(state.baseMapId);
    // With a real base map the world is an outline plus landmarks; there is no
    // procedural lot grid to claim, so we place on open land instead.
    const city = bm ? null : cityContext(state);
    const bmObstacles = bm ? landmarkRects(bm) : [];
    for (let i = 0; i < count; i++) {
      const jitter = 0.85 + rng() * 0.3;
      // On a real base map, sizes come from the map's own scale rather than the
      // abstract grid the procedural city uses.
      const scaled = bm ? BASEMAP_ENTITY_SIZE[detected.kind] : null;
      const round1 = (v: number) => Math.round(v * 10) / 10;
      let w = scaled ? round1(scaled.w * jitter) : Math.round(detected.size.w * jitter);
      let h = scaled ? round1(scaled.h * jitter) : Math.round(detected.size.h * jitter);
      const baseHeight = scaled ? scaled.height : DEFAULT_HEIGHT_BY_KIND[detected.kind];
      let height = baseHeight > 0 ? (scaled ? round1(baseHeight * jitter) : Math.round(baseHeight * jitter)) : 0;
      // "tower"/"skyscraper" should actually tower.
      if (scaled && detected.kind === "building" && /\b(tower|skyscraper|highrise|high rise)\b/.test(text)) height = round1(height * 3.2);
      let rotation = detected.kind === "vehicle" || detected.kind === "road" ? Math.round(rng() * 4) * 90 : 0;
      const meta: Record<string, unknown> = { prompt };
      let spot: { x: number; y: number } | null = null;

      if (city && detected.kind === "building") {
        // Buildings claim a free lot in the procedural city, nearest to where the prompt pointed.
        const target = anchor
          ? { x: anchor.x + anchor.w / 2, y: anchor.y + anchor.h / 2 }
          : region
            ? { x: region[0] * state.width, y: region[1] * state.height }
            : { x: rng() * state.width, y: rng() * state.height };
        const lot = nearestFreeLot(city.layout, target.x, target.y, city.taken, zone?.id);
        if (lot) {
          city.taken.add(lot.id);
          spot = { x: Math.round(lot.x), y: Math.round(lot.y) };
          w = Math.round(lot.w);
          h = Math.round(lot.h);
          height = lot.zoneId === "central" ? Math.max(height, lot.height) : Math.max(24, Math.round(lot.height * 1.4));
          meta.lotId = lot.id;
        }
      }
      if (!spot) {
        const solid = detected.kind !== "road" && detected.kind !== "water";
        const obstacles = city && solid ? cityObstacles(city.layout, city.taken) : solid ? bmObstacles : [];
        const opts = { bm, allowWater: !solid, avoidGreen: detected.kind === "building" };
        spot = anchor
          ? nearSpot(anchor, w, h, working, rng, obstacles, opts)
          : freeSpot(working, w, h, region, rng, obstacles, opts);
        if (city && detected.kind === "vehicle") {
          const snapped = snapToRoad(city.layout, spot.x + w / 2, spot.y + h / 2);
          spot = { x: Math.round(snapped.x - w / 2), y: Math.round(snapped.y - h / 2) };
          rotation = snapped.axis === "v" ? 90 : 0;
        } else if (bm && detected.kind === "vehicle") {
          // Put traffic on a real street, pointing the way the street runs.
          const snapped = nearestRoad(bm, spot.x + w / 2, spot.y + h / 2);
          if (snapped) {
            spot = { x: Math.round(snapped.x - w / 2), y: Math.round(snapped.y - h / 2) };
            rotation = Math.round(snapped.angle);
          }
        }
      }
      if (bm && zone?.style) {
        // Things added to a themed district take on that district's look.
        height = Math.max(1, Math.round(height * zone.style.heightScale));
      }

      const entity: WorldEntity = {
        id: newId(),
        kind: detected.kind,
        name,
        x: spot.x,
        y: spot.y,
        w,
        h,
        rotation,
        height,
        color,
        spriteUrl: null,
        meta,
      };
      ops.push({ op: "add", entity });
      working = { ...working, entities: [...working.entities, entity] };
    }
    const where = anchor ? ` near the ${anchor.name}` : zone ? ` in the ${zone.name}` : region ? " on the map" : "";
    return { ops, summary: `added ${count > 1 ? `${count} ${name}s` : `a ${name}`}${where}`.trim() };
  }
}

export class PlanError extends Error {}
