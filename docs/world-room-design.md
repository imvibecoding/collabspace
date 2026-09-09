# World Rooms — design note (2026-09-09)

## Why this replaces the flat art wall as the viral room

A shared world is a better top-of-funnel product than a shared image: every prompt is a
*visible, attributable object* ("that's my taxi") rather than a repaint that erases the
previous person's work. It also fits the engine we already built: queue lanes, credits,
moderation, reputation, revert and appeal all apply unchanged.

## Core idea: the world is data, not pixels

```
WorldState = { width, height, theme, backgroundUrl, entities: WorldEntity[] }
WorldEntity = { id, kind, name, x, y, w, h, rotation, color, spriteUrl, meta }
```

A prompt is turned into a **WorldPatch** (a list of add / remove / move / modify ops) by a
**planner**, then applied to the state. `applyPatch` returns the inverse patch, so:

- **revert** = apply the inverse (already wired into the downvote / appeal flow)
- **timelapse** = replay patches from `world_initial`
- **snapshot** = freeze the state JSON
- **fork** = copy a snapshot's state into a new private room (brief §2.5)

The room stores `world` and `world_initial` (jsonb); each applied submission stores
`{ patch, inverse }`.

## Pluggable pieces (all mock today, zero cost)

| Seam | Today | Later |
| --- | --- | --- |
| `BaseWorldGenerator` (prompt → base map) | deterministic SVG city-block map | image model for 2D; **Hunyuan3D-WorldClaw** for the 3D stage (open release just announced; inputs/licence not yet documented, so treat as an experiment, not a dependency) |
| `SpriteGenerator` (entity → sprite) | top-down SVG glyphs by kind/colour | image model with a fixed "top-down sprite, transparent bg" system prompt, cached per (kind, name, colour) |
| `WorldPlanner` (prompt → patch) | rule-based: verbs, nouns, counts, colours, regions, "near the X" | LLM planner returning the same patch schema (structured output); the heuristic stays as fallback |

## Room rules

World rooms allow longer prompts (12 words) than the art wall (6). Public worlds are queue
mode; forks are private and start freeform. The planner rejects prompts it can't ground
("vibes") and the submission is refunded.

## 2D → 3D migration path

1. Keep `WorldState` as the source of truth; add `z` and a `modelUrl` per entity.
2. Swap `BaseWorldGenerator` to produce a 3D scene (WorldClaw or similar) and store an
   isometric render as `backgroundUrl` for the 2D viewer.
3. Swap the viewer for an isometric / three.js renderer reading the same entities.

Nothing in the queue, credit, moderation or reputation layers changes.
