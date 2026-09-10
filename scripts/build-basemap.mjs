/**
 * Builds the Melbourne base map from OpenStreetMap, once, into a committed
 * JSON asset (src/lib/world/basemap-melbourne.json).
 *
 * Run with:  node scripts/build-basemap.mjs
 *
 * We do this offline rather than at runtime because the Overpass query takes
 * ~7s and returns ~9MB; the shipped asset is a simplified outline of a few
 * hundred KB with no network dependency in production.
 *
 * Data © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("src/lib/world/basemap-melbourne.json");
const SIZE = 1024; // world units on the long axis

// Zoomed out enough to read as "Melbourne": the bay's eastern shore, the Yarra,
// the CBD and the inner suburbs in every direction.
const BBOX = { south: -37.93, west: 144.85, north: -37.74, east: 145.06 };

/** Landmarks we hand-model. Matched on an exact OSM name. */
const LANDMARKS = [
  { id: "eureka", name: "Eureka Tower", height: 297 },
  { id: "rialto", name: "Rialto Towers", height: 251 },
  { id: "stpauls", name: "Saint Paul's Cathedral", height: 68 },
  { id: "mcg", name: "Melbourne Cricket Ground", height: 40 },
  { id: "fedsquare", name: "Federation Square", height: 16 },
  { id: "shrine", name: "Shrine of Remembrance", height: 45 },
  { id: "exhibition", name: "Royal Exhibition Building", height: 68 },
];

/* ----------------------------- projection -------------------------------- */

const midLat = (BBOX.north + BBOX.south) / 2;
const mPerDegLat = 110574;
const mPerDegLon = 111320 * Math.cos((midLat * Math.PI) / 180);
const widthM = (BBOX.east - BBOX.west) * mPerDegLon;
const heightM = (BBOX.north - BBOX.south) * mPerDegLat;
const scale = SIZE / Math.max(widthM, heightM);
const offsetX = (SIZE - widthM * scale) / 2;
const offsetY = (SIZE - heightM * scale) / 2;

/** lat/lon → world coords (x east, y south), fitted and centred in a SIZE square. */
function project(lat, lon) {
  const x = (lon - BBOX.west) * mPerDegLon * scale + offsetX;
  const y = (BBOX.north - lat) * mPerDegLat * scale + offsetY;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

/* ----------------------------- simplify ---------------------------------- */

function perpDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ramer–Douglas–Peucker on [[x,y],...]. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

const flat = (pts) => pts.flat();
const areaOf = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a / 2);
};

/* ------------------------------- fetch ----------------------------------- */

async function overpass(query) {
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "collabspace-basemap-builder/1.0 (upnadam87@gmail.com)",
    },
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

const BB = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;

async function main() {
  console.log("querying Overpass…");
  const t0 = Date.now();
  const data = await overpass(`[out:json][timeout:120];
(
  way["natural"="coastline"](${BB});
  way["natural"="water"](${BB});
  way["waterway"="riverbank"](${BB});
  way["highway"~"^(motorway|trunk|primary)$"](${BB});
  way["leisure"="park"](${BB});
  way["landuse"~"^(forest|recreation_ground)$"](${BB});
);
out geom;`);
  console.log(`  ${data.elements.length} elements in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const landmarkData = await overpass(`[out:json][timeout:60];
(
${LANDMARKS.map((l) => `  way["name"="${l.name}"](${BB});\n  relation["name"="${l.name}"](${BB});`).join("\n")}
);
out geom;`);
  console.log(`  ${landmarkData.elements.length} landmark elements`);

  const geo = (e) => (e.geometry ?? []).filter((g) => g && g.lat != null).map((g) => project(g.lat, g.lon));

  /* water: polygons for lakes/river, polylines for the coast */
  const water = [];
  const coast = [];
  for (const e of data.elements) {
    const t = e.tags ?? {};
    const pts = geo(e);
    if (pts.length < 2) continue;
    if (t.natural === "coastline") {
      const s = simplify(pts, 1.5);
      if (s.length >= 2) coast.push(flat(s));
    } else if (t.natural === "water" || t.waterway === "riverbank") {
      const s = simplify(pts, 1.2);
      if (s.length >= 3 && areaOf(s) > 12) water.push(flat(s));
    }
  }

  /* Port Phillip Bay: OSM ships the shore as many short, directed ways. Join them
     end-to-start into one path, then close it along the seaward (south-west) side
     so the renderer has a single fillable polygon. */
  const sea = (() => {
    const chains = coast.map((f) => {
      const pts = [];
      for (let i = 0; i < f.length; i += 2) pts.push([f[i], f[i + 1]]);
      return pts;
    });
    const key = (p) => `${p[0]},${p[1]}`;
    const byStart = new Map(chains.map((c) => [key(c[0]), c]));
    const used = new Set();
    let best = [];
    for (const c of chains) {
      if (used.has(c)) continue;
      let path = [...c];
      used.add(c);
      for (;;) {
        const next = byStart.get(key(path[path.length - 1]));
        if (!next || used.has(next)) break;
        used.add(next);
        path = path.concat(next.slice(1));
      }
      if (path.length > best.length) best = path;
    }
    if (best.length < 4) return [];
    const closeY = Math.max(SIZE, ...best.map((p) => p[1])) + 40;
    const ring = [...best, [best[best.length - 1][0], closeY], [-40, closeY], [-40, best[0][1]]];
    return flat(simplify(ring, 1.2));
  })();

  /* parks and reserves: keep the ones big enough to read when zoomed out */
  const green = data.elements
    .filter((e) => (e.tags?.leisure === "park" || e.tags?.landuse) && (e.geometry?.length ?? 0) >= 3)
    .map((e) => simplify(geo(e), 1.2))
    .filter((s) => s.length >= 3)
    .map((s) => ({ area: areaOf(s), pts: flat(s) }))
    .sort((a, b) => b.area - a.area)
    .slice(0, 60)
    .filter((g) => g.area > 60)
    .map((g) => g.pts);

  /* major roads: simplified polylines, widest classes first, capped */
  const roadWidth = { motorway: 7, trunk: 5, primary: 3.5 };
  const roads = data.elements
    .filter((e) => roadWidth[e.tags?.highway] && (e.geometry?.length ?? 0) >= 2)
    .map((e) => {
      const s = simplify(geo(e), 1.5);
      let len = 0;
      for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      return { w: roadWidth[e.tags.highway], len, pts: flat(s) };
    })
    .filter((r) => r.len > 12 && r.pts.length >= 4)
    .sort((a, b) => b.w - a.w || b.len - a.len)
    .slice(0, 700)
    .map((r) => ({ w: r.w, pts: r.pts }));

  /* landmarks: real footprint centre + footprint size, matched by exact name */
  const landmarks = [];
  for (const want of LANDMARKS) {
    const hit = landmarkData.elements.find((e) => e.tags?.name === want.name && (e.geometry?.length ?? 0) >= 3);
    if (!hit) { console.warn(`  ! no OSM match for ${want.name}`); continue; }
    const pts = geo(hit);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    landmarks.push({
      id: want.id,
      name: want.name,
      x: Math.round(minX * 10) / 10,
      y: Math.round(minY * 10) / 10,
      w: Math.max(6, Math.round((maxX - minX) * 10) / 10),
      h: Math.max(6, Math.round((maxY - minY) * 10) / 10),
      height: want.height,
    });
  }

  const out = {
    source: "osm",
    attribution: "© OpenStreetMap contributors (ODbL)",
    built: new Date().toISOString().slice(0, 10),
    size: SIZE,
    bbox: [BBOX.south, BBOX.west, BBOX.north, BBOX.east],
    water,
    coast,
    sea,
    green,
    roads,
    landmarks,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`wrote ${OUT} (${kb} KB)`);
  console.log(`  water ${water.length} · coast ${coast.length} · sea pts ${sea.length / 2} · green ${green.length} · roads ${roads.length} · landmarks ${landmarks.length}`);
  console.log(`  landmarks: ${landmarks.map((l) => l.name).join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
