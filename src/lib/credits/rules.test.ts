import { describe, expect, it } from "vitest";
import { canJoinPrivateRoom, creditsForProviderCost, kindAllowedForTier, planSpend } from "./rules";

describe("planSpend", () => {
  it("uses free credits first in public rooms", () => {
    expect(planSpend({ roomVisibility: "public", balance: { free: 3, paid: 10 }, amount: 5 })).toEqual({
      ok: true,
      fromFree: 3,
      fromPaid: 2,
    });
  });
  it("never uses free credits in private rooms", () => {
    expect(planSpend({ roomVisibility: "private", balance: { free: 100, paid: 4 }, amount: 5 })).toEqual({
      ok: false,
      reason: "insufficient_credits",
      shortfall: 1,
    });
    expect(planSpend({ roomVisibility: "private", balance: { free: 100, paid: 5 }, amount: 5 })).toEqual({
      ok: true,
      fromFree: 0,
      fromPaid: 5,
    });
  });
  it("treats zero-cost actions as free", () => {
    expect(planSpend({ roomVisibility: "private", balance: { free: 0, paid: 0 }, amount: 0 })).toEqual({
      ok: true,
      fromFree: 0,
      fromPaid: 0,
    });
  });
});

describe("creditsForProviderCost", () => {
  it("applies margin and rounds up to whole credits, minimum 1", () => {
    expect(creditsForProviderCost(0)).toBe(1);
    expect(creditsForProviderCost(4)).toBe(3); // 4c * 1.3 = 5.2c → 3 credits
    expect(creditsForProviderCost(10)).toBe(7); // 13c → 7 credits
  });
});

describe("tier + eligibility", () => {
  it("gates video behind premium", () => {
    expect(kindAllowedForTier("video", "free")).toBe(false);
    expect(kindAllowedForTier("video", "premium")).toBe(true);
    expect(kindAllowedForTier("image", "free")).toBe(true);
  });
  it("requires card on file and phone verification for private rooms", () => {
    expect(canJoinPrivateRoom({ card_on_file: true, phone_verified: true })).toBe(true);
    expect(canJoinPrivateRoom({ card_on_file: false, phone_verified: true })).toBe(false);
  });
});
