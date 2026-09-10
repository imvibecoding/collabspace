# World Rooms — design note (updated 2026-09-10)

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
- **snapshot** = freeze the state JSON (read-only, on-site; forking is not offered)

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
- **Views**: an angled 3D city and a north-up bird's-eye plan of the same world (the old 2D
  isometric SVG renderer is gone). Areas are clickable and fly the camera to that district.
  A loading overlay covers the first frames while shaders compile.
- **Renderer** (`components/world-3d.tsx`): merged wall/roof geometry with tiling window
  textures whose emissive layer lights up at night; instanced trees, lamps and neon signs;
  trams and cars gliding along the grid; stars; optional rain; bloom for neon and lit windows.
  Orthographic camera, orbit/zoom/pan.
- **Time of day** (`sun.ts`): solar altitude/azimuth for Melbourne's lat/long in the
  Australia/Melbourne timezone drives sun direction, colour, ambient, sky, fog, window/lamp/
  neon glow and stars. A scrubber lets a visitor preview any hour.

## Fidelity: where the graphics can actually go

Procedural boxes give structure and lighting, not the painted density of the
Shadowrun-style reference. Three levers, in order of payoff:

1. **Real geometry from OpenStreetMap (recommended).** Probed 2026-09-10 against the
   Overpass API for the CBD box (-37.825,144.950 → -37.808,144.975): **2,095 building
   footprints in 7.1s, 754 with height/levels tags, 609 named** — Eureka Tower, Rialto
   Towers, Crown, St Paul's, the Exhibition Centre all present with real outlines and
   heights. Licence is ODbL: free to use with attribution. This is the honest route to
   "it actually resembles Melbourne": extrude real footprints instead of generated lots,
   keep the district/lot/prompt system on top. Cost: a fetch-and-cache step at world
   creation, polygon extrusion instead of rectangles, and an attribution line in the UI.
2. **Art assets.** Per-district facade texture sets, kerbs/street furniture, and landmark
   meshes. Blender 5.1 is installed locally and can run headless
   (`blender --background --python`) to bake these; or a CC0 kit. Needs an explicit
   download/authoring step.
3. **Image-model textures / an LLM planner.** The `SpriteGenerator` and `WorldPlanner`
   seams already exist for this.

**Not viable:** Google Earth/Maps screenshots. Their terms don't allow deriving base maps
or textures from that imagery, so it can't be the source even as a "guide" for generated
assets. OSM gives the same real-world fidelity without the licensing problem.

**Hunyuan3D-WorldClaw** — re-checked 2026-09-10 (third check). The repo still holds only
`README.md` and an `assets/` folder; the single changelog line remains "2026.08.07: Paper
and project page are released!". No code, weights, licence or API, so there is nothing to
run and nothing to feed a reference image into. It also reads as open-world/terrain
generation rather than urban. Revisit if it ships.

## Room rules

World rooms allow 12-word prompts. Public worlds are queue mode; private worlds start
freeform, where prompts apply immediately at the base price. **Creating** a room costs
credits up front (world 60, art 25, kanban free) since it builds and then hosts a whole
city. **Forking is deliberately not offered** — worlds stay on collabspace; snapshots are
the on-site way to keep a moment. The planner rejects
prompts it can't ground ("vibes") and the submission is refunded.
