import { describe, expect, it } from "vitest";
import { isoDepth, isoFootprintCorners, isoViewBox, raise, shade, toIso } from "./iso";

describe("toIso", () => {
  it("maps the origin to the origin", () => {
    expect(toIso(0, 0)).toEqual({ x: 0, y: 0 });
  });
  it("moves right along +x, down-right along +y", () => {
    expect(toIso(100, 0)).toEqual({ x: 100, y: 50 });
    expect(toIso(0, 100)).toEqual({ x: -100, y: 50 });
  });
});

describe("isoDepth", () => {
  it("orders back-to-front the same way iso screen-y does", () => {
    const a = toIso(10, 10).y;
    const b = toIso(50, 50).y;
    expect(isoDepth(10, 10) < isoDepth(50, 50)).toBe(true);
    expect(a < b).toBe(true);
  });
});

describe("isoViewBox", () => {
  it("covers the full projected diamond for a square world", () => {
    const vb = isoViewBox(1024, 1024);
    expect(vb).toEqual({ minX: -1024, minY: 0, width: 2048, height: 1024 });
    // every corner of the world should fall within [minX, minX+width] x [minY, minY+height]
    for (const [x, y] of [[0, 0], [1024, 0], [0, 1024], [1024, 1024]]) {
      const p = toIso(x, y);
      expect(p.x).toBeGreaterThanOrEqual(vb.minX);
      expect(p.x).toBeLessThanOrEqual(vb.minX + vb.width);
      expect(p.y).toBeGreaterThanOrEqual(vb.minY);
      expect(p.y).toBeLessThanOrEqual(vb.minY + vb.height);
    }
  });
});

describe("isoFootprintCorners", () => {
  it("produces a back/right/front/left diamond in world-space order", () => {
    const c = isoFootprintCorners({ x: 0, y: 0, w: 100, h: 50 });
    expect(c.back).toEqual(toIso(0, 0));
    expect(c.right).toEqual(toIso(100, 0));
    expect(c.front).toEqual(toIso(100, 50));
    expect(c.left).toEqual(toIso(0, 50));
    // back is topmost (smallest screen-y), front is bottommost
    expect(c.back.y).toBeLessThan(c.front.y);
  });
  it("swaps w/h for a 90-degree rotation", () => {
    const c = isoFootprintCorners({ x: 0, y: 0, w: 100, h: 50, rotation: 90 });
    expect(c.right).toEqual(toIso(50, 0));
    expect(c.front).toEqual(toIso(50, 100));
  });
});

describe("raise", () => {
  it("shifts a point up on screen without moving it sideways", () => {
    const p = toIso(10, 10);
    expect(raise(p, 20)).toEqual({ x: p.x, y: p.y - 20 });
  });
});

describe("shade", () => {
  it("darkens and lightens a hex color", () => {
    expect(shade("#886644", 0.5)).toBe("#443322");
    expect(shade("#101010", 2)).toBe("#202020");
  });
  it("clamps at 0 and 255", () => {
    expect(shade("#ffffff", 2)).toBe("#ffffff");
    expect(shade("#000000", 0.5)).toBe("#000000");
  });
  it("passes through non-hex input unchanged", () => {
    expect(shade("red", 0.5)).toBe("red");
  });
});
