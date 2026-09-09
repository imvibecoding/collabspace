# World Rooms — design note (updated 2026-09-09, evening)

## Why this is the viral room

A shared world is a better top-of-funnel product than a shared image: every prompt is a
*visible, attributable object* ("that's my taxi") rather than a repaint that erases the
previous person's work. It fits the engine we already built: queue lanes, credits,
moderation, reputation, revert and appeal all apply unchanged.

## Core idea: the world is data, not pixels

```
WorldState  = { width, height, theme, zones, citySeed, entities: WorldEntity[] }
WorldEntity = { id, kind, name, x, y, w, h, height, rotation, color, meta }
```

A prompt becomes a **WorldPatch** (add / remove / move / modify ops) via a **planner**, then
applied to the state. `applyPatch` returns the inverse patch, so:

- **revert** = apply the inverse (wired into downvotes / appeals)
- **timelapse** = replay patches from `world_initial`
- **snapshot** = freeze the state JSON
- **fork** = copy a snapshot's state into a new private room

## The city itself (3D, since the evening of 2026-09-09)

The flagship public world is **Melbourne**: an isometric three.js city, rendered with
react-three-fiber, that follows the real sun over Melbourne.

- **Districts** (`zones.ts`): Central (the CBD square, 40% of each axis, so the whole map is
  ~6× the CBD's area), North, South, East, West. Real-suburb-inspired flavor text, aliases
  ("toorak", "footscray") and thematic vocabulary. Explicit place names route a prompt;
  thematic words bias an unaddressed prompt ("a getaway car" lands West).
- **Procedural layout** (`city.ts`): deterministic from `citySeed`, so the server and the
  browser derive the same roads, lots, parks, trees, tram lines, lamps, the Yarra and the bay,
  and landmarks (Eureka, Rialto, Flinders St, Fed Square, Arts Centre spire, MCG) without
  storing thousands of lots in the DB. Per-district profiles set block size, lot density,
  height range and facade style (CBD towers, North terraces/warehouses, West sheds, South
  mansions/apartments, East houses with street trees).
- **Placement** (`planner.ts`): buildings claim the nearest free lot (the procedural building
  on that lot disappears and the user's takes its place), vehicles snap onto the road grid,
  everything else avoids the procedural city as obstacles.
- **Renderer** (`components/world-3d.tsx`): merged wall/roof geometry with tiling window
  textures whose emissive layer lights up at night; instanced trees, lamps and neon signs;
  trams and cars gliding along the grid; stars; optional rain; bloom for neon and lit windows.
  Orthographic camera, orbit/zoom/pan. The old 2D isometric map (`world-view.tsx`) stays as a
  "2D map" fallback toggle.
- **Time of day** (`sun.ts`): solar altitude/azimuth for Melbourne's lat/long in the
  Australia/Melbourne timezone drives sun direction, colour, ambient, sky, fog, window/lamp/
  neon glow and stars. A scrubber lets a visitor preview any hour.

## What the reference look needs that we don't have yet

The Shadowrun-style concept art is hand-painted: surface grime, signage, clutter, wet
reflections, volumetric light. Procedural boxes give the *structure* and the *lighting*,
not that texture richness. The upgrade path, in order of payoff:

1. Better materials: per-district facade texture sets (brick, concrete, glass) instead of one
   window tile; roof clutter (AC units, water tanks); sidewalks and kerbs.
2. Real assets: Blender 5.1 is installed on the dev machine, so landmark and prop meshes can
   be generated headlessly (`blender --background --python`) and exported as GLB; or CC0 kits.
   (Nothing is auto-downloaded; that's an explicit step.)
3. Image-model textures / an LLM planner: the `SpriteGenerator` and `WorldPlanner` seams exist
   for this.
4. **Hunyuan3D-WorldClaw** (checked 2026-09-09, twice): paper + teaser page only. No code,
   weights, licence or API, and it reads as open-world/terrain generation rather than urban.
   Not a dependency; revisit if it ships.

## Room rules

World rooms allow 12-word prompts. Public worlds are queue mode; private worlds and forks
start freeform, where prompts apply immediately at the base price. The planner rejects
prompts it can't ground ("vibes") and the submission is refunded.
