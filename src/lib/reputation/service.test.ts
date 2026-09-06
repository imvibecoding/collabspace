import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { HeuristicAppealReviewer, penaltyForStrike } = await import("./service");

const sub = { id: "s", room_id: "r", user_id: "author" } as never;

describe("penaltyForStrike", () => {
  it("escalates instead of one-striking", () => {
    expect(penaltyForStrike(1)).toEqual({ priorityPenalty: 1, cooldownMinutes: 0 });
    expect(penaltyForStrike(2).cooldownMinutes).toBe(10);
    expect(penaltyForStrike(3).cooldownMinutes).toBe(60);
    expect(penaltyForStrike(7).cooldownMinutes).toBe(1440);
  });
});

describe("HeuristicAppealReviewer", () => {
  const reviewer = new HeuristicAppealReviewer();
  it("detects a coordinated pile-on", async () => {
    const t = Date.parse("2026-09-06T00:00:00Z");
    const v = await reviewer.review({
      submission: sub,
      authorStrikes: 1,
      flags: [0, 10_000, 20_000].map((d, i) => ({
        reporter_id: `r${i}`,
        weight: 0.3,
        created_at: new Date(t + d).toISOString(),
        otherActivityInRoom: 0,
      })),
    });
    expect(v.brigading).toBe(true);
    expect(v.signals.length).toBeGreaterThanOrEqual(3);
  });
  it("upholds organic downvotes from established members", async () => {
    const t = Date.parse("2026-09-06T00:00:00Z");
    const v = await reviewer.review({
      submission: sub,
      authorStrikes: 3,
      flags: [0, 600_000, 1_800_000].map((d, i) => ({
        reporter_id: `r${i}`,
        weight: 1.2,
        created_at: new Date(t + d).toISOString(),
        otherActivityInRoom: 5,
      })),
    });
    expect(v.brigading).toBe(false);
  });
  it("does not treat a clean author history alone as brigading", async () => {
    const v = await reviewer.review({
      submission: sub,
      authorStrikes: 0,
      flags: [{ reporter_id: "a", weight: 1, created_at: new Date().toISOString(), otherActivityInRoom: 3 }],
    });
    expect(v.brigading).toBe(false);
  });
});
