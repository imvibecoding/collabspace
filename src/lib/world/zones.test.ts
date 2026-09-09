import { describe, expect, it } from "vitest";
import { detectZoneByAlias, melbourneZones, zoneAt, zoneCenter, zoneForPrompt, zoneHint } from "./zones";

const zones = melbourneZones(1024);

describe("melbourneZones", () => {
  it("covers the whole map with five non-overlapping zones", () => {
    expect(zones.map((z) => z.id).sort()).toEqual(["central", "east", "north", "south", "west"]);
    // sample a grid of points; every point should land in exactly one zone
    for (let x = 0; x < 1024; x += 64) {
      for (let y = 0; y < 1024; y += 64) {
        const hits = zones.filter((z) => x >= z.bounds.x && x < z.bounds.x + z.bounds.w && y >= z.bounds.y && y < z.bounds.y + z.bounds.h);
        expect(hits.length).toBe(1);
      }
    }
  });
  it("puts central in the middle and north/south/east/west where their names suggest", () => {
    expect(zoneAt(zones, 512, 512)?.id).toBe("central");
    expect(zoneAt(zones, 512, 10)?.id).toBe("north");
    expect(zoneAt(zones, 512, 1000)?.id).toBe("south");
    expect(zoneAt(zones, 10, 512)?.id).toBe("west");
    expect(zoneAt(zones, 1000, 512)?.id).toBe("east");
  });
});

describe("zoneCenter / zoneHint", () => {
  it("returns the bounds midpoint as a 0..1 fraction of world size", () => {
    const central = zones.find((z) => z.id === "central")!;
    const c = zoneCenter(central);
    expect(c.x).toBeCloseTo(512, 0);
    expect(c.y).toBeCloseTo(512, 0);
    const [fx, fy] = zoneHint(central, 1024);
    expect(fx).toBeCloseTo(0.5, 1);
    expect(fy).toBeCloseTo(0.5, 1);
  });
});

describe("detectZoneByAlias", () => {
  it("matches a real place name to its zone", () => {
    expect(detectZoneByAlias("build a bank in toorak", zones)?.id).toBe("south");
    expect(detectZoneByAlias("open a cafe in footscray", zones)?.id).toBe("west");
    expect(detectZoneByAlias("build a bank in the cbd", zones)?.id).toBe("central");
  });
  it("prefers the longer, more specific alias", () => {
    // "south yarra" should win over the generic "south" zone alias for the same zone anyway,
    // but "st kilda" must not be misread as matching a shorter unrelated alias.
    expect(detectZoneByAlias("a house in st kilda", zones)?.id).toBe("south");
  });
  it("returns null with no place name", () => {
    expect(detectZoneByAlias("build a house", zones)).toBeNull();
  });
});

describe("zoneForPrompt", () => {
  it("biases crime-flavoured prompts toward the west without naming it", () => {
    expect(zoneForPrompt("park a getaway car for the heist", zones)?.id).toBe("west");
  });
  it("biases wealth-flavoured prompts toward the south", () => {
    expect(zoneForPrompt("build a mansion with a yacht", zones)?.id).toBe("south");
  });
  it("biases office/finance prompts toward central", () => {
    expect(zoneForPrompt("open a corporate office tower", zones)?.id).toBe("central");
  });
  it("returns null when nothing matches", () => {
    expect(zoneForPrompt("add a dinosaur", zones)).toBeNull();
  });
});
