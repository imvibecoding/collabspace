# World Rooms — design note (updated 2026-09-10, evening)

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

## The base map is real (since 2026-09-10)

The city is no longer generated: it is Melbourne's actual outline, taken from
OpenStreetMap and shipped as a 44 KB committed asset
(`src/lib/world/basemap-melbourne.json`, built by `scripts/build-basemap.mjs`).

What's in it, for a ~21 km box around the CBD:

- **Water** — Port Phillip Bay (the shore's many directed ways joined end-to-start
  and closed into one fillable ring), the Yarra, and 53 lakes/riverbank polygons.
- **Green** — the 60 largest parks and reserves.
- **Roads** — 538 motorway/trunk/primary ways, simplified with Douglas–Peucker.
- **Landmarks** — 7 matched by exact OSM name and hand-modelled in three.js at
  their real coordinates: Eureka Tower, Rialto Towers, St Paul's Cathedral, the
  MCG, Federation Square, the Shrine of Remembrance, the Royal Exhibition Building.

Deliberately **not** every building. The base is an outline plus landmarks;
everything else is what people prompt in. Districts are realigned to the real
geography (`melbourneGeoZones`), which the tests assert by checking the MCG falls
in East, the Exhibition Building in North, the Shrine in South, and Rialto and
Fed Square in Central.

### Scale

~20 m per world unit, so real heights are exaggerated ×3.6 to keep a skyline
readable. Prompted things use `BASEMAP_ENTITY_SIZE` rather than true scale — a
real car is 0.2 units and would be invisible — so small things are enlarged
enough to see once you zoom into a district.

### Area restyling

A prompt like "make the west look like an industrial port" applies a `ZoneStyle`
(ground tint, facade palette, height scale, density, neon) to a whole district.
It's an ordinary patch, so it reverts, replays and appeals like anything else.
Ten looks are recognised: slum, neon/cyberpunk, tropical, desert, snow, forest,
industrial, luxury, ruins, medieval. Priced at 15 credits against 1 for a normal
prompt, since it changes a whole quarter of the map.

### Why not Google, and what about WorldClaw

Google Earth/Maps imagery can't be the source: their terms don't permit deriving
base maps or textures from it, even as a guide for generated assets. OSM gives
the same real-world fidelity under ODbL with attribution.

**Hunyuan3D-WorldClaw** — checked three times (2026-09-09 twice, 2026-09-10). The
repo still holds only `README.md` and an `assets/` folder, with one changelog
line: "2026.08.07: Paper and project page are released!". No code, weights,
licence or API, so there is nothing to run and nothing to feed a reference image
into. Revisit if it ships.

### Still open

Texture richness. Structure and lighting are real; surfaces are flat colour.
Next levers: per-district facade textures, street furniture, and landmark meshes
baked in Blender 5.1 (installed locally, runs headless) or a CC0 kit.

## Room rules

World rooms allow 12-word prompts. Public worlds are queue mode; private worlds start
freeform, where prompts apply immediately at the base price. **Creating** a room costs
credits up front (world 60, art 25, kanban free) since it builds and then hosts a whole
city. **Forking is deliberately not offered** — worlds stay on collabspace; snapshots are
the on-site way to keep a moment. The planner rejects
prompts it can't ground ("vibes") and the submission is refunded.
