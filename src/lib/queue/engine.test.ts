import { describe, expect, it } from "vitest";
import {
  baseLaneWeight,
  nextWindowStart,
  pickBaseWinner,
  pickPremiumWinner,
  resolveWindow,
  submissionCost,
  validateBid,
  windowStart,
  type PendingSubmission,
  type QueueRoomConfig,
} from "./engine";

const config: QueueRoomConfig = {
  baseWindowSeconds: 300,
  premiumWindowSeconds: 300,
  basePriceCredits: 1,
  premiumMinBidCredits: 5,
  premiumBidIncrementCredits: 1,
  instantPriceCredits: 20,
};

function sub(partial: Partial<PendingSubmission> & { id: string }): PendingSubmission {
  return {
    userId: `u-${partial.id}`,
    lane: "base",
    bidCredits: 0,
    createdAt: new Date("2026-09-06T00:00:00Z"),
    ...partial,
  };
}

describe("windowStart", () => {
  it("floors to the window boundary", () => {
    const now = new Date("2026-09-06T10:07:42Z");
    expect(windowStart(now, 300).toISOString()).toBe("2026-09-06T10:05:00.000Z");
    expect(nextWindowStart(now, 300).toISOString()).toBe("2026-09-06T10:10:00.000Z");
  });
});

describe("submissionCost", () => {
  it("charges flat price for base, the bid for premium, and the instant price", () => {
    expect(submissionCost(config, "base")).toBe(1);
    expect(submissionCost(config, "premium", 7)).toBe(7);
    expect(submissionCost(config, "instant")).toBe(20);
  });
});

describe("validateBid", () => {
  it("enforces the room minimum when no bids exist", () => {
    expect(validateBid(config, 4, null)).toMatchObject({ ok: false, minimumBid: 5 });
    expect(validateBid(config, 5, null)).toEqual({ ok: true });
  });
  it("enforces the increment over the current highest bid", () => {
    expect(validateBid(config, 8, 8)).toMatchObject({ ok: false, minimumBid: 9 });
    expect(validateBid(config, 9, 8)).toEqual({ ok: true });
  });
  it("rejects non-integer bids", () => {
    expect(validateBid(config, 5.5, null).ok).toBe(false);
  });
});

describe("pickPremiumWinner", () => {
  it("returns null with no premium submissions", () => {
    expect(pickPremiumWinner([])).toBeNull();
  });
  it("picks the highest bid, ties broken by earliest", () => {
    const a = sub({ id: "a", lane: "premium", bidCredits: 10, createdAt: new Date(2000) });
    const b = sub({ id: "b", lane: "premium", bidCredits: 10, createdAt: new Date(1000) });
    const c = sub({ id: "c", lane: "premium", bidCredits: 7 });
    expect(pickPremiumWinner([a, b, c])?.id).toBe("b");
  });
});

describe("pickBaseWinner", () => {
  it("is deterministic given an rng", () => {
    const subs = [sub({ id: "a" }), sub({ id: "b" }), sub({ id: "c" })];
    expect(pickBaseWinner(subs, () => 0)?.id).toBe("a");
    expect(pickBaseWinner(subs, () => 0.5)?.id).toBe("b");
    expect(pickBaseWinner(subs, () => 0.99)?.id).toBe("c");
  });
  it("down-weights penalised users", () => {
    expect(baseLaneWeight(0)).toBe(1);
    expect(baseLaneWeight(1)).toBe(0.5);
    expect(baseLaneWeight(3)).toBe(0.25);
    // a: weight 1, b: weight 0.25 → total 1.25; rng 0.85 → 1.0625 lands in b's slice
    const subs = [sub({ id: "a" }), sub({ id: "b", priorityPenalty: 3 })];
    expect(pickBaseWinner(subs, () => 0.79)?.id).toBe("a");
    expect(pickBaseWinner(subs, () => 0.85)?.id).toBe("b");
  });
});

describe("resolveWindow", () => {
  it("applies premium first, then base, and refunds the rest", () => {
    const pending = [
      sub({ id: "p1", lane: "premium", bidCredits: 5 }),
      sub({ id: "p2", lane: "premium", bidCredits: 9 }),
      sub({ id: "b1" }),
      sub({ id: "b2" }),
    ];
    const { applied, refunded } = resolveWindow(pending, () => 0.99);
    expect(applied.map((s) => s.id)).toEqual(["p2", "b2"]);
    expect(refunded.map((s) => s.id).sort()).toEqual(["b1", "p1"]);
  });
  it("handles a window with only one lane populated", () => {
    const { applied, refunded } = resolveWindow([sub({ id: "b1" })]);
    expect(applied.map((s) => s.id)).toEqual(["b1"]);
    expect(refunded).toEqual([]);
  });
  it("handles an empty window", () => {
    expect(resolveWindow([])).toEqual({ applied: [], refunded: [] });
  });
});
