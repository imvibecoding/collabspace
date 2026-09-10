/**
 * City districts. A zone is a named region of the world with a ground tint
 * and a vocabulary: place names/words that route an explicit prompt there
 * ("build a bank in Toorak"), and thematic words that bias an *unaddressed*
 * prompt there when it matches ("spawn a getaway car" leans West).
 *
 * `melbourneZones` is flavor inspired by Melbourne's real layout, not a
 * factual claim about its suburbs or the people who live there.
 */

export interface WorldZone {
  id: string;
  /** Short label shown on the map, e.g. "West". */
  name: string;
  /** Longer descriptor shown on hover, e.g. "Inner West — Footscray, Yarraville". */
  subtitle: string;
  bounds: { x: number; y: number; w: number; h: number };
  /** Ground tint for this zone's tiles. */
  color: string;
  /** Literal place names that route an explicit prompt to this zone. */
  aliases: string[];
  /** Thematic words that bias an unaddressed prompt toward this zone. */
  vibe: string[];
  /** Applied by a "make the west look like…" prompt. See ZoneStyle below. */
  style?: ZoneStyle;
}

export function zoneCenter(zone: WorldZone) {
  return { x: zone.bounds.x + zone.bounds.w / 2, y: zone.bounds.y + zone.bounds.h / 2 };
}

export function zoneAt(zones: WorldZone[], x: number, y: number): WorldZone | null {
  return (
    zones.find((z) => x >= z.bounds.x && x < z.bounds.x + z.bounds.w && y >= z.bounds.y && y < z.bounds.y + z.bounds.h) ?? null
  );
}

/** Match a normalized prompt against zone place names, longest alias first. */
export function detectZoneByAlias(text: string, zones: WorldZone[]): WorldZone | null {
  const candidates = zones
    .flatMap((zone) => zone.aliases.map((alias) => ({ zone, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const { zone, alias } of candidates) {
    const pattern = alias.includes(" ") ? alias.replace(/\s+/g, "\\s+") : `\\b${alias}\\b`;
    if (new RegExp(pattern).test(text)) return zone;
  }
  return null;
}

/** Pick the zone whose thematic vocabulary best matches the prompt. Null if nothing overlaps. */
export function zoneForPrompt(text: string, zones: WorldZone[]): WorldZone | null {
  let best: { zone: WorldZone; score: number } | null = null;
  for (const zone of zones) {
    const score = zone.vibe.filter((word) => text.includes(word)).length;
    if (score > 0 && (!best || score > best.score)) best = { zone, score };
  }
  return best?.zone ?? null;
}

/** Fractional [x,y] hint (0..1) for a zone's center, for the placement search. */
export function zoneHint(zone: WorldZone, worldSize: number): [number, number] {
  const c = zoneCenter(zone);
  return [c.x / worldSize, c.y / worldSize];
}

/**
 * Default city layout: a central business district with four surrounding
 * quarters. Covers the whole map with no gaps or overlaps.
 */
export function melbourneZones(size: number): WorldZone[] {
  const band = Math.round(size * 0.3);
  return [
    {
      id: "north",
      name: "North",
      subtitle: "Inner North — Fitzroy, Brunswick, Northcote",
      bounds: { x: 0, y: 0, w: size, h: band },
      color: "#7a6a52",
      aliases: ["north", "fitzroy", "brunswick", "northcote", "collingwood"],
      vibe: ["graffiti", "street art", "warehouse", "brewery", "vintage", "bike", "bicycle", "cafe", "market", "terrace", "band", "gig", "tattoo", "vinyl", "hipster"],
    },
    {
      id: "south",
      name: "South",
      subtitle: "Bayside — St Kilda, South Yarra, Toorak",
      bounds: { x: 0, y: size - band, w: size, h: band },
      color: "#4f8f7a",
      aliases: ["south", "st kilda", "stkilda", "south yarra", "southyarra", "toorak", "bayside"],
      vibe: ["mansion", "yacht", "polo", "boutique", "beach", "palm", "sports car", "private school", "tennis", "pool", "luxury", "designer", "penthouse", "pompous", "posh", "rich", "wealthy", "fancy"],
    },
    {
      id: "west",
      name: "West",
      subtitle: "Inner West — Footscray, Yarraville",
      bounds: { x: 0, y: band, w: band, h: size - band * 2 },
      color: "#5a5a52",
      aliases: ["west", "footscray", "yarraville", "sunshine"],
      vibe: ["warehouse", "factory", "container", "freight", "gritty", "crime", "gang", "police", "cop", "abandoned", "back alley", "graffiti", "underworld", "getaway", "heist", "smuggl"],
    },
    {
      id: "east",
      name: "East",
      subtitle: "Inner East — Richmond, Hawthorn, Camberwell",
      bounds: { x: size - band, y: band, w: band, h: size - band * 2 },
      color: "#6b7f52",
      aliases: ["east", "richmond", "hawthorn", "camberwell"],
      vibe: ["private school", "garden", "heritage", "cricket", "golf", "cafe", "boutique", "renovation", "leafy", "brunch"],
    },
    {
      id: "central",
      name: "Central",
      subtitle: "CBD & Docklands",
      bounds: { x: band, y: band, w: size - band * 2, h: size - band * 2 },
      color: "#8a8a8a",
      aliases: ["central", "cbd", "downtown", "docklands", "melbourne"],
      vibe: ["office", "bank", "tram", "laneway", "coffee", "suit", "corporate", "skyscraper", "courthouse", "station", "business", "government", "parliament", "finance", "pompous", "posh"],
    },
  ];
}

/** Starter prompts run once at world creation so each zone has character from the start. */
export function melbourneSeedPrompts(): Array<{ zoneId: string; prompt: string }> {
  return [
    { zoneId: "central", prompt: "build a glass office tower downtown" },
    { zoneId: "central", prompt: "add a tram on the street in the cbd" },
    { zoneId: "north", prompt: "paint a graffiti mural on a warehouse in fitzroy" },
    { zoneId: "north", prompt: "open a hipster cafe in brunswick" },
    { zoneId: "west", prompt: "build a shipping container depot in footscray" },
    { zoneId: "west", prompt: "park a police car by the warehouse in the west" },
    { zoneId: "south", prompt: "build a white mansion with a pool in toorak" },
    { zoneId: "south", prompt: "park a yellow sports car outside the mansion" },
    { zoneId: "east", prompt: "plant a leafy garden with an oak tree in hawthorn" },
    { zoneId: "east", prompt: "build a heritage brick house in camberwell" },
  ];
}

/* -------------------------------------------------------------------------- */
/* Area theming                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A look applied to a whole district by a prompt ("make the west look like a
 * rainy industrial port"). Themes are a palette + a few knobs, not new geometry,
 * so they apply instantly and revert cleanly like any other patch.
 */
export interface ZoneStyle {
  /** What was asked for, shown in history and on the area chip. */
  label: string;
  /** Ground tint for the district. */
  ground: string;
  /** Facade palette for buildings placed here. */
  palette: string[];
  /** Multiplier on the height of buildings added here. */
  heightScale: number;
  /** 0..1 scatter of small clutter. */
  density: number;
  /** 0..1 likelihood of neon signage at night. */
  neon: number;
}

const THEMES: Array<{ words: string[]; style: Omit<ZoneStyle, "label"> }> = [
  {
    words: ["slum", "shanty", "favela", "shack", "tin", "corrugated", "informal settlement"],
    style: { ground: "#8a7350", palette: ["#a8703f", "#8d6a4a", "#b5895c", "#7d6b52", "#9c5f3c"], heightScale: 0.35, density: 0.95, neon: 0.05 },
  },
  {
    words: ["neon", "cyberpunk", "cyber", "blade runner", "synthwave", "futuristic"],
    style: { ground: "#1e2030", palette: ["#2b3350", "#3a2f55", "#22304a", "#402a4d"], heightScale: 1.6, density: 0.7, neon: 0.9 },
  },
  {
    words: ["beach", "tropical", "island", "resort", "palm", "seaside"],
    style: { ground: "#d9c896", palette: ["#f0e7d4", "#e8dcc2", "#cfd8c2", "#f5efe2"], heightScale: 0.6, density: 0.4, neon: 0.1 },
  },
  {
    words: ["desert", "dune", "sand", "outback", "arid"],
    style: { ground: "#d5b678", palette: ["#d8c9a3", "#c2ab7f", "#e0d2ae", "#b59a6e"], heightScale: 0.5, density: 0.3, neon: 0.05 },
  },
  {
    words: ["snow", "arctic", "ice", "frozen", "winter", "alpine"],
    style: { ground: "#e4ecf2", palette: ["#cfd8e0", "#dde5ec", "#b9c4cf", "#eef3f7"], heightScale: 0.7, density: 0.3, neon: 0.1 },
  },
  {
    words: ["forest", "jungle", "woods", "overgrown", "rainforest", "park"],
    style: { ground: "#4d7a3c", palette: ["#6b5a3f", "#7d6b4a", "#59683f", "#8a7550"], heightScale: 0.5, density: 0.8, neon: 0.02 },
  },
  {
    words: ["industrial", "factory", "port", "docks", "warehouse", "freight", "refinery"],
    style: { ground: "#5c5a54", palette: ["#7a776f", "#8c8a82", "#6f6c64", "#9a978c"], heightScale: 0.8, density: 0.6, neon: 0.15 },
  },
  {
    words: ["luxury", "wealthy", "rich", "mansion", "posh", "opulent", "gold"],
    style: { ground: "#6f8f72", palette: ["#f0ece2", "#e9e4d8", "#dad3c2", "#d4c39a"], heightScale: 1.1, density: 0.3, neon: 0.1 },
  },
  {
    words: ["ruin", "ruins", "apocalypse", "abandoned", "derelict", "wasteland", "bombed"],
    style: { ground: "#6b6455", palette: ["#6e675c", "#807868", "#5c564c", "#8a7f6d"], heightScale: 0.55, density: 0.9, neon: 0.02 },
  },
  {
    words: ["medieval", "castle", "old town", "cobble", "fantasy"],
    style: { ground: "#7e7256", palette: ["#9a8a6d", "#87795f", "#b0a184", "#75694f"], heightScale: 0.7, density: 0.6, neon: 0.0 },
  },
];

const DEFAULT_STYLE: Omit<ZoneStyle, "label"> = {
  ground: "#8a8a8a",
  palette: ["#b9b4a6", "#a8a39a", "#c6c1b4", "#97928a"],
  heightScale: 1,
  density: 0.5,
  neon: 0.2,
};

/** Turn a free-text description of a look into a district style. */
export function deriveZoneStyle(description: string): ZoneStyle {
  const text = description.toLowerCase();
  const hit = THEMES.find((t) => t.words.some((w) => text.includes(w)));
  return { label: description.trim().slice(0, 60), ...(hit?.style ?? DEFAULT_STYLE) };
}

/**
 * Districts aligned to the real Melbourne base map: the CBD sits where the CBD
 * actually is, with the quarters around it. (`melbourneZones` keeps the plain
 * banded layout for worlds without a real base map.)
 */
export function melbourneGeoZones(size: number): WorldZone[] {
  const generic = melbourneZones(size);
  const byId = Object.fromEntries(generic.map((z) => [z.id, z]));
  const cx0 = Math.round(size * 0.46);
  const cx1 = Math.round(size * 0.6);
  const cy0 = Math.round(size * 0.35);
  const cy1 = Math.round(size * 0.465);
  const bounds: Record<string, WorldZone["bounds"]> = {
    north: { x: 0, y: 0, w: size, h: cy0 },
    south: { x: 0, y: cy1, w: size, h: size - cy1 },
    west: { x: 0, y: cy0, w: cx0, h: cy1 - cy0 },
    east: { x: cx1, y: cy0, w: size - cx1, h: cy1 - cy0 },
    central: { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 },
  };
  return generic.map((z) => ({ ...byId[z.id], bounds: bounds[z.id] }));
}
