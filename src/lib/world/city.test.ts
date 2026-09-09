import { describe, expect, it } from "vitest";
import { cityObstacles, generateCity, nearestFreeLot, overlaps, snapToRoad } from "./city";
import { melbourneZones, zoneAt } from "./zones";

const zones = melbourneZones(1024);

describe("generateCity", () => {
  const city = generateCity("melbourne-test", zones);

  it("is deterministic for a seed", () => {
    const again = generateCity("melbourne-test", zones);
    expect(again.lots.length).toBe(city.lots.length);
    expect(again.lots[10]).toEqual(city.lots[10]);
    expect(generateCity("other", zones).lots[10]).not.toEqual(city.lots[10]);
  });

  it("produces a dense CBD and lower districts", () => {
    const byZone = (id: string) => city.lots.filter((l) => l.zoneId === id);
    const avg = (id: string) => byZone(id).reduce((a, l) => a + l.height, 0) / byZone(id).length;
    expect(byZone("central").length).toBeGreaterThan(80);
    expect(avg("central")).toBeGreaterThan(avg("north") * 3);
    expect(avg("east")).toBeLessThan(14);
  });

  it("keeps buildings out of the water and off landmarks", () => {
    const water = [...city.river, ...(city.bay ? [city.bay] : [])];
    for (const lot of city.lots) {
      expect(water.some((w) => overlaps(lot, w))).toBe(false);
      expect(city.landmarks.some((l) => overlaps(lot, l))).toBe(false);
    }
  });

  it("places landmarks where they belong: river-side and the MCG to the east", () => {
    const eureka = city.landmarks.find((l) => l.id === "eureka")!;
    const mcg = city.landmarks.find((l) => l.id === "mcg")!;
    expect(zoneAt(zones, mcg.x + mcg.w / 2, mcg.y + mcg.h / 2)?.id).toBe("east");
    expect(eureka.y).toBeGreaterThan(city.river[0].y); // south of the river
    expect(eureka.height).toBeGreaterThan(250);
  });

  it("has tram lines and lamps", () => {
    expect(city.roads.some((r) => r.tram)).toBe(true);
    expect(city.lamps.length).toBeGreaterThan(50);
    expect(city.trees.length).toBeGreaterThan(100);
  });
});

describe("planner helpers", () => {
  const city = generateCity("melbourne-test", zones);

  it("finds the nearest free lot and honours taken lots", () => {
    const a = nearestFreeLot(city, 512, 512, new Set())!;
    expect(a.zoneId).toBe("central");
    const b = nearestFreeLot(city, 512, 512, new Set([a.id]))!;
    expect(b.id).not.toBe(a.id);
    const west = nearestFreeLot(city, 512, 512, new Set(), "west")!;
    expect(west.zoneId).toBe("west");
  });

  it("snaps to a road centreline", () => {
    const p = snapToRoad(city, 500, 500);
    const onRoad = city.roads.some((r) => (r.axis === "v" ? Math.abs(r.x + r.w / 2 - p.x) < 0.01 : Math.abs(r.y + r.h / 2 - p.y) < 0.01));
    expect(onRoad).toBe(true);
  });

  it("excludes taken lots from obstacles", () => {
    const first = city.lots[0];
    expect(cityObstacles(city, new Set()).some((o) => o === first)).toBe(true);
    expect(cityObstacles(city, new Set([first.id])).some((o) => o === first)).toBe(false);
  });
});
