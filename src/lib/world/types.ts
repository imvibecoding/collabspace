import type { WorldZone } from "./zones";

/**
 * World rooms: a shared top-down 2D world (old-GTA style) that people grow
 * through prompts. The world is *data*, not an image: a base map plus a list
 * of placed entities. Prompts become patches against that state, which gives
 * us history, revert, timelapse, snapshots and forks for free.
 *
 * The same state model carries over to 3D later: entities gain a z / model
 * reference, and the base map becomes a WorldClaw-generated scene.
 */

export const ENTITY_KINDS = [
  "building",
  "road",
  "tree",
  "water",
  "vehicle",
  "character",
  "animal",
  "prop",
  "sign",
  "scene",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface WorldEntity {
  id: string;
  kind: EntityKind;
  /** Short display name, e.g. "red sports car". */
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** Visual elevation in the isometric renderer (screen px at full zoom). 0 = flat (roads, water). */
  height: number;
  color: string | null;
  spriteUrl: string | null;
  /** Provenance: which submission created it, free-form extras. */
  meta: Record<string, unknown>;
}

/** Default isometric extrusion height per kind; the planner jitters around this. */
export const DEFAULT_HEIGHT_BY_KIND: Record<EntityKind, number> = {
  building: 72,
  road: 0,
  tree: 30,
  water: 0,
  vehicle: 16,
  character: 20,
  animal: 15,
  prop: 18,
  sign: 24,
  scene: 26,
};

export interface WorldState {
  width: number;
  height: number;
  theme: string;
  backgroundUrl: string | null;
  entities: WorldEntity[];
  /** City districts (empty for non-city themes). See src/lib/world/zones.ts. */
  zones: WorldZone[];
}

export type WorldOp =
  | { op: "add"; entity: WorldEntity }
  | { op: "remove"; id: string; entity?: WorldEntity }
  | { op: "move"; id: string; x: number; y: number; rotation?: number; from?: { x: number; y: number; rotation: number } }
  | { op: "modify"; id: string; changes: Partial<Pick<WorldEntity, "name" | "color" | "w" | "h" | "spriteUrl" | "kind">>; before?: Partial<WorldEntity> };

export interface WorldPatch {
  ops: WorldOp[];
  /** Human-readable summary for history, e.g. "added 3 trees near the river". */
  summary: string;
}

export const DEFAULT_WORLD_SIZE = 1024;

export function emptyWorld(theme = "city"): WorldState {
  return { width: DEFAULT_WORLD_SIZE, height: DEFAULT_WORLD_SIZE, theme, backgroundUrl: null, entities: [], zones: [] };
}
