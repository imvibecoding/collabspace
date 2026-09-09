import { describe, expect, it } from "vitest";
import { dateAtLocalHour, daylightAt, localHour, mixHex, palette, sunPosition } from "./sun";

describe("sunPosition (Melbourne)", () => {
  it("is high at local noon in summer and below the horizon at midnight", () => {
    // 2026-01-15 13:00 AEDT (UTC+11) = 02:00 UTC; solar noon is ~13:20 AEDT in Jan.
    const noon = new Date("2026-01-15T02:00:00Z");
    const midnight = new Date("2026-01-15T13:00:00Z");
    expect(sunPosition(noon).altitude).toBeGreaterThan(1.2); // > ~69°
    expect(sunPosition(midnight).altitude).toBeLessThan(0);
  });
  it("is low at winter noon", () => {
    const winterNoon = new Date("2026-06-21T02:20:00Z"); // 12:20 AEST
    const alt = sunPosition(winterNoon).altitude;
    expect(alt).toBeGreaterThan(0.4);
    expect(alt).toBeLessThan(0.6); // ~28-30°
  });
});

describe("daylightAt", () => {
  it("classifies day, night and twilight", () => {
    expect(daylightAt(new Date("2026-01-15T02:00:00Z")).phase).toBe("day");
    expect(daylightAt(new Date("2026-01-15T13:00:00Z")).phase).toBe("night");
    const d = daylightAt(new Date("2026-01-15T09:45:00Z")); // ~20:45 AEDT, sun setting
    expect(["dusk", "night", "day"]).toContain(d.phase);
    expect(daylightAt(new Date("2026-01-15T02:00:00Z")).daylight).toBe(1);
    expect(daylightAt(new Date("2026-01-15T13:00:00Z")).daylight).toBe(0);
  });
});

describe("localHour / dateAtLocalHour", () => {
  it("reads Melbourne wall-clock time", () => {
    expect(localHour(new Date("2026-01-15T02:30:00Z"))).toBeCloseTo(13.5, 2);
    expect(localHour(new Date("2026-06-21T02:30:00Z"))).toBeCloseTo(12.5, 2);
  });
  it("round-trips a target hour", () => {
    const ref = new Date("2026-01-15T02:30:00Z");
    expect(localHour(dateAtLocalHour(21, ref))).toBeCloseTo(21, 2);
  });
});

describe("palette", () => {
  it("interpolates between night and day", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    const night = palette(daylightAt(new Date("2026-01-15T13:00:00Z")));
    const day = palette(daylightAt(new Date("2026-01-15T02:00:00Z")));
    expect(night.sky).toBe("#0a0f22");
    expect(day.sky).toBe("#9ecbf0");
  });
});
