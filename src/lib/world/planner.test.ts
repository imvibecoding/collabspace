import { describe, expect, it } from "vitest";
import { HeuristicPlanner, PlanError } from "./planner";
import { applyPatch, replay } from "./patch";
import { emptyWorld, type WorldState } from "./types";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
let n = 0;
const ids = () => `e${++n}`;
const planner = new HeuristicPlanner();
const ctx = (state: WorldState) => ({ state, rng: seeded(), newId: ids });

describe("HeuristicPlanner", () => {
  it("adds a named, coloured entity of the detected kind", async () => {
    const p = await planner.plan("park a red sports car downtown", ctx(emptyWorld()));
    expect(p.ops).toHaveLength(1);
    const op = p.ops[0];
    expect(op.op === "add" && op.entity.kind).toBe("vehicle");
    expect(op.op === "add" && op.entity.name).toBe("red sports car");
    expect(op.op === "add" && op.entity.color).toBe("red");
    expect(p.summary).toContain("added a red sports car");
  });

  it("adds multiple entities without overlapping", async () => {
    const p = await planner.plan("plant three pine trees in the top left", ctx(emptyWorld()));
    expect(p.ops).toHaveLength(3);
    const { state } = applyPatch(emptyWorld(), p);
    expect(state.entities.every((e) => e.x < 400 && e.y < 400)).toBe(true);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const a = state.entities[i];
      const b = state.entities[j];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
  });

  it("places near a referenced entity", async () => {
    let state = emptyWorld();
    state = applyPatch(state, await planner.plan("build a bank in the centre", ctx(state))).state;
    const bank = state.entities[0];
    const p = await planner.plan("put a police car outside the bank", ctx(state));
    const car = p.ops[0].op === "add" ? p.ops[0].entity : null;
    expect(car?.kind).toBe("vehicle");
    expect(Math.abs(car!.x - bank.x) < 250 && Math.abs(car!.y - bank.y) < 250).toBe(true);
    expect(p.summary).toContain("near the bank");
  });

  it("removes, moves and modifies existing entities and produces working inverses", async () => {
    let state = emptyWorld();
    state = applyPatch(state, await planner.plan("add a blue house", ctx(state))).state;
    const house = state.entities[0];

    const mod = await planner.plan("paint the house red and make it bigger", ctx(state));
    expect(mod.ops[0]).toMatchObject({ op: "modify", id: house.id, changes: { color: "red", name: "red house" } });
    const afterMod = applyPatch(state, mod);
    expect(afterMod.state.entities[0].w).toBeGreaterThan(house.w);
    expect(applyPatch(afterMod.state, afterMod.inverse).state.entities[0]).toEqual(house);

    const mv = await planner.plan("move the house to the bottom right", ctx(afterMod.state));
    expect(mv.ops[0]).toMatchObject({ op: "move", id: house.id });
    const afterMove = applyPatch(afterMod.state, mv);
    expect(afterMove.state.entities[0].x).toBeGreaterThan(600);

    const rm = await planner.plan("demolish the house", ctx(afterMove.state));
    expect(rm.ops[0]).toMatchObject({ op: "remove", id: house.id });
    const afterRm = applyPatch(afterMove.state, rm);
    expect(afterRm.state.entities).toHaveLength(0);
    expect(applyPatch(afterRm.state, afterRm.inverse).state.entities).toHaveLength(1);
  });

  it("rejects prompts it cannot ground", async () => {
    await expect(planner.plan("vibes", ctx(emptyWorld()))).rejects.toBeInstanceOf(PlanError);
    await expect(planner.plan("remove the dragon", ctx(emptyWorld()))).rejects.toBeInstanceOf(PlanError);
  });

  it("caps counts", async () => {
    const p = await planner.plan("spawn 500 zombies", ctx(emptyWorld()));
    expect(p.ops.length).toBe(12);
  });
});

describe("replay", () => {
  it("reconstructs intermediate states for a timelapse", async () => {
    const s0 = emptyWorld();
    const p1 = await planner.plan("add a cafe", ctx(s0));
    const s1 = applyPatch(s0, p1).state;
    const p2 = await planner.plan("add two dogs near the cafe", ctx(s1));
    expect(replay(s0, [p1, p2], 1).entities).toHaveLength(1);
    expect(replay(s0, [p1, p2]).entities).toHaveLength(3);
  });
});
