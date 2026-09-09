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
  const band = Math.round(size * 0.32);
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
