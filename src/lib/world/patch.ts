import type { WorldEntity, WorldOp, WorldPatch, WorldState } from "./types";

/**
 * Apply a patch to a world state. Returns the new state plus the inverse patch
 * (so a revert is just another applyPatch). Pure and deterministic.
 */
export function applyPatch(state: WorldState, patch: WorldPatch): { state: WorldState; inverse: WorldPatch } {
  const entities = [...state.entities];
  const zones = [...(state.zones ?? [])];
  const inverseOps: WorldOp[] = [];

  for (const op of patch.ops) {
    switch (op.op) {
      case "add": {
        if (entities.some((e) => e.id === op.entity.id)) break;
        entities.push(op.entity);
        inverseOps.unshift({ op: "remove", id: op.entity.id, entity: op.entity });
        break;
      }
      case "remove": {
        const idx = entities.findIndex((e) => e.id === op.id);
        if (idx === -1) break;
        const [removed] = entities.splice(idx, 1);
        inverseOps.unshift({ op: "add", entity: removed });
        break;
      }
      case "move": {
        const idx = entities.findIndex((e) => e.id === op.id);
        if (idx === -1) break;
        const e = entities[idx];
        inverseOps.unshift({ op: "move", id: e.id, x: e.x, y: e.y, rotation: e.rotation });
        entities[idx] = { ...e, x: op.x, y: op.y, rotation: op.rotation ?? e.rotation };
        break;
      }
      case "zone": {
        const idx = zones.findIndex((z) => z.id === op.zoneId);
        if (idx === -1) break;
        inverseOps.unshift({ op: "zone", zoneId: op.zoneId, style: zones[idx].style ?? null });
        zones[idx] = { ...zones[idx], style: op.style ?? undefined };
        break;
      }
      case "modify": {
        const idx = entities.findIndex((e) => e.id === op.id);
        if (idx === -1) break;
        const e = entities[idx];
        const before: Partial<WorldEntity> = {};
        for (const k of Object.keys(op.changes) as Array<keyof typeof op.changes>) {
          (before as Record<string, unknown>)[k] = e[k];
        }
        inverseOps.unshift({ op: "modify", id: e.id, changes: before as WorldOp extends { op: "modify"; changes: infer C } ? C : never });
        entities[idx] = { ...e, ...op.changes };
        break;
      }
    }
  }

  return {
    state: { ...state, entities, zones },
    inverse: { ops: inverseOps, summary: `undo: ${patch.summary}` },
  };
}

/** Replay a list of patches from an initial state (timelapse). */
export function replay(initial: WorldState, patches: WorldPatch[], upTo = patches.length): WorldState {
  let s = initial;
  for (const p of patches.slice(0, upTo)) s = applyPatch(s, p).state;
  return s;
}

export function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, pad = 4) {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
}
