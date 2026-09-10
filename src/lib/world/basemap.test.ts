import { describe, expect, it } from "vitest";
import { BASE_MAPS, getBaseMap, heightUnits, inWater, metresPerUnit, nearestRoad, pointInRing, rectInWater } from "./basemap";
import { melbourneGeoZones, zoneAt } from "./zones";

const bm = BASE_MAPS.melbourne;

describe("melbourne base map asset", () => {
  it("has the outline data we extracted from OSM", () => {
    expect(bm.source).toBe("osm");
    expect(bm.attribution).toMatch(/OpenStreetMap/);
    expect(bm.size).toBe(1024);
    expect(bm.water.length).toBeGreaterThan(10);
    expect(bm.sea.length).toBeGreaterThan(20);
    expect(bm.roads.length).toBeGreaterThan(200);
    expect(bm.green.length).toBeGreaterThan(10);
  });

  it("carries the hand-modelled landmarks", () => {
    const ids = bm.landmarks.map((l) => l.id).sort();
    expect(ids).toEqual(["eureka", "exhibition", "fedsquare", "mcg", "rialto", "shrine", "stpauls"]);
    const eureka = bm.landmarks.find((l) => l.id === "eureka")!;
    expect(eureka.height).toBe(297);
    // Every landmark sits inside the map and on dry land.
    for (const l of bm.landmarks) {
      expect(l.x).toBeGreaterThan(0);
      expect(l.x).toBeLessThan(bm.size);
      expect(l.y).toBeGreaterThan(0);
      expect(l.y).toBeLessThan(bm.size);
    }
  });

  it("places landmarks in the districts they really belong to", () => {
    const zones = melbourneGeoZones(bm.size);
    const zoneOf = (id: string) => {
      const l = bm.landmarks.find((x) => x.id === id)!;
      return zoneAt(zones, l.x + l.w / 2, l.y + l.h / 2)?.id;
    };
    expect(zoneOf("rialto")).toBe("central");
    expect(zoneOf("fedsquare")).toBe("central");
    expect(zoneOf("mcg")).toBe("east");
    expect(zoneOf("exhibition")).toBe("north");
    expect(zoneOf("shrine")).toBe("south");
  });
});

describe("geometry helpers", () => {
  it("does point-in-polygon", () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(15, 5, square)).toBe(false);
  });

  it("knows the bay is water and the CBD is not", () => {
    // Bay: well south-west of the city centre.
    expect(inWater(bm, 120, 900)).toBe(true);
    // Rialto Towers' block.
    const rialto = bm.landmarks.find((l) => l.id === "rialto")!;
    expect(inWater(bm, rialto.x, rialto.y)).toBe(false);
  });

  it("rejects footprints that touch water", () => {
    expect(rectInWater(bm, { x: 110, y: 890, w: 20, h: 20 })).toBe(true);
    const rialto = bm.landmarks.find((l) => l.id === "rialto")!;
    expect(rectInWater(bm, { x: rialto.x, y: rialto.y, w: 4, h: 4 })).toBe(false);
  });

  it("snaps to a nearby real road", () => {
    const p = nearestRoad(bm, 550, 420);
    expect(p).not.toBeNull();
    expect(Math.hypot(p!.x - 550, p!.y - 420)).toBeLessThan(60);
  });
});

describe("scale", () => {
  it("converts metres to exaggerated world units", () => {
    const mpu = metresPerUnit(bm);
    expect(mpu).toBeGreaterThan(15);
    expect(mpu).toBeLessThan(30);
    // Eureka should out-top the Shrine by roughly its real ratio.
    expect(heightUnits(bm, 297)).toBeGreaterThan(heightUnits(bm, 45) * 5);
  });
});

describe("getBaseMap", () => {
  it("resolves by id and ignores unknown ids", () => {
    expect(getBaseMap("melbourne")).toBe(bm);
    expect(getBaseMap("atlantis")).toBeNull();
    expect(getBaseMap(null)).toBeNull();
  });
});
