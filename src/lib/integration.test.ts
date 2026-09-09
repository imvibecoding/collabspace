/**
 * Integration test against the local Supabase stack (`npm run db:start`).
 * Exercises the queue, ledger, reputation and appeal paths end to end.
 * Skipped automatically when the local stack is not reachable.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOM_COST_CREDITS } from "@/lib/rooms/service";

vi.mock("server-only", () => ({}));

function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

async function stackUp(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY } });
    return r.ok;
  } catch {
    return false;
  }
}

const up = await stackUp();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!up)("local stack integration", () => {
  const run = Math.random().toString(36).slice(2, 8);
  const userIds: string[] = [];
  let roomId = "";

  const mod = {} as {
    admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
    submit: typeof import("@/lib/queue/service").submit;
    resolveDueWindows: typeof import("@/lib/queue/service").resolveDueWindows;
    downvote: typeof import("@/lib/reputation/service").downvote;
    appeal: typeof import("@/lib/reputation/service").appeal;
    createRoom: typeof import("@/lib/rooms/service").createRoom;
    inviteByEmail: typeof import("@/lib/rooms/service").inviteByEmail;
    getBalances: typeof import("@/lib/credits/ledger").getBalances;
    grant: typeof import("@/lib/credits/ledger").grant;
    spend: typeof import("@/lib/credits/ledger").spend;
  };

  async function mkUser(tag: string, opts: { score?: number } = {}) {
    const email = `${tag}-${run}@test.local`;
    const { data, error } = await mod.admin.auth.admin.createUser({
      email,
      password: `pw-${run}-${tag}`,
      email_confirm: true,
      user_metadata: { display_name: tag },
    });
    if (error) throw error;
    const id = data.user.id;
    userIds.push(id);
    if (opts.score !== undefined) {
      await mod.admin.from("reputation_scores").update({ score: opts.score }).eq("user_id", id);
    }
    return { id, email };
  }

  beforeAll(async () => {
    const [{ createAdminClient }, queue, rep, rooms, ledger] = await Promise.all([
      import("@/lib/supabase/admin"),
      import("@/lib/queue/service"),
      import("@/lib/reputation/service"),
      import("@/lib/rooms/service"),
      import("@/lib/credits/ledger"),
    ]);
    mod.admin = createAdminClient();
    mod.submit = queue.submit;
    mod.resolveDueWindows = queue.resolveDueWindows;
    mod.downvote = rep.downvote;
    mod.appeal = rep.appeal;
    mod.createRoom = rooms.createRoom;
    mod.inviteByEmail = rooms.inviteByEmail;
    mod.getBalances = ledger.getBalances;
    mod.grant = ledger.grant;
    mod.spend = ledger.spend;
  });

  afterAll(async () => {
    if (roomId) await mod.admin.from("rooms").delete().eq("id", roomId);
    for (const id of userIds) await mod.admin.auth.admin.deleteUser(id);
  });

  it("runs lanes, refunds, downvotes and appeals end to end", async () => {
    const a = await mkUser("a");
    const b = await mkUser("b");
    const c = await mkUser("c");
    const d = await mkUser("d");
    for (const u of [a, b, c, d]) await mod.grant({ userId: u.id, kind: "image", amount: 100, reason: "test" });

    const room = await mod.createRoom({ ownerId: a.id, name: `it-${run}`, type: "art", visibility: "public" });
    roomId = room.id;
    // Window is short so the test doesn't wait long for resolution, but long enough that the
    // handful of submit() calls below can't accidentally roll over into the next window.
    await mod.admin.from("rooms").update({ base_window_seconds: 3, premium_window_seconds: 3 }).eq("id", roomId);

    // Submissions in one window: A base, B premium 5, C premium 7.
    const sa = await mod.submit({ userId: a.id, roomId, prompt: "calm lake", lane: "base" });
    const sb = await mod.submit({ userId: b.id, roomId, prompt: "red sun", lane: "premium", bidCredits: 5 });
    const sc = await mod.submit({ userId: c.id, roomId, prompt: "blue moon", lane: "premium", bidCredits: 7 });
    expect(sa.ok && sb.ok && sc.ok).toBe(true);
    const low = await mod.submit({ userId: d.id, roomId, prompt: "late bid", lane: "premium", bidCredits: 7 });
    expect(low).toMatchObject({ ok: false, code: "bid" });
    const banned = await mod.submit({ userId: d.id, roomId, prompt: "gore fest", lane: "base" });
    expect(banned).toMatchObject({ ok: false, code: "moderation" });

    await sleep(3300);
    const totals = await mod.resolveDueWindows(roomId);
    expect(totals).toEqual({ applied: 2, refunded: 1 });

    // Losing bid refunded; winners charged.
    expect((await mod.getBalances(b.id)).image.paid).toBe(100);
    expect((await mod.getBalances(c.id)).image.paid).toBe(93);
    expect((await mod.getBalances(a.id)).image.paid).toBe(100 - ROOM_COST_CREDITS.art - 1);

    // Premium applied first, base second → base winner is the current state.
    const { data: r1 } = await mod.admin.from("rooms").select("current_submission_id").eq("id", roomId).single();
    const aId = (sa as { submissionId: string }).submissionId;
    const cId = (sc as { submissionId: string }).submissionId;
    expect(r1?.current_submission_id).toBe(aId);

    // Organic downvotes from established members revert A's change and strike A.
    expect(await mod.downvote(a.id, aId)).toMatchObject({ ok: false });
    expect(await mod.downvote(b.id, aId)).toMatchObject({ ok: true, reverted: false });
    expect(await mod.downvote(b.id, aId)).toMatchObject({ ok: false }); // duplicate
    expect(await mod.downvote(c.id, aId)).toMatchObject({ ok: true, reverted: false });
    expect(await mod.downvote(d.id, aId)).toMatchObject({ ok: true, reverted: true });
    const { data: r2 } = await mod.admin.from("rooms").select("current_submission_id").eq("id", roomId).single();
    expect(r2?.current_submission_id).toBe(cId);
    const { data: repA } = await mod.admin.from("reputation_scores").select("*").eq("user_id", a.id).single();
    expect(repA?.strikes).toBe(1);
    expect(repA?.priority_penalty).toBe(1);

    // A's appeal is rejected: downvoters are reputable and active in the room.
    const ap1 = await mod.appeal(a.id, aId);
    expect(ap1.ok && !ap1.verdict.brigading).toBe(true);

    // A coordinated pile-on by fresh low-rep accounts gets caught on appeal.
    const e = await mkUser("e", { score: 0.3 });
    const f = await mkUser("f", { score: 0.3 });
    const g = await mkUser("g", { score: 0.3 });
    // 3 × 0.3 < threshold, so add a fourth and fifth to cross it... simpler: bump weights to hit 3.0
    await mod.admin.from("reputation_scores").update({ score: 1.0 }).in("user_id", [e.id, f.id, g.id]);
    for (const u of [e, f, g]) await mod.downvote(u.id, cId);
    const { data: subC } = await mod.admin.from("queue_submissions").select("status").eq("id", cId).single();
    expect(subC?.status).toBe("reverted");
    // Restore their true low reputation so the appeal sees low-rep + burst + no activity.
    await mod.admin.from("moderation_flags").update({ weight: 0.3 }).eq("submission_id", cId);
    const ap2 = await mod.appeal(c.id, cId);
    expect(ap2.ok && ap2.verdict.brigading).toBe(true);
    const { data: subC2 } = await mod.admin.from("queue_submissions").select("status").eq("id", cId).single();
    expect(subC2?.status).toBe("applied");
    const { data: repE } = await mod.admin.from("reputation_scores").select("strikes").eq("user_id", e.id).single();
    expect(repE?.strikes).toBe(1);
  }, 30_000);

  it("keeps free credits out of private rooms and suggests queue mode at 4 members", async () => {
    const owner = await mkUser("o");
    const priv = await mod.createRoom({ ownerId: owner.id, name: `priv-${run}`, type: "kanban", visibility: "private" });
    try {
      await mod.grant({ userId: owner.id, kind: "image", amount: 50, reason: "monthly_grant", freeTier: true });
      await expect(
        mod.spend({ userId: owner.id, kind: "image", amount: 1, reason: "test", roomId: priv.id }),
      ).rejects.toMatchObject({ shortfall: 1 });

      const m2 = await mkUser("m2");
      const m3 = await mkUser("m3");
      const m4 = await mkUser("m4");
      const i2 = await mod.inviteByEmail(priv.id, owner.id, m2.email);
      const i3 = await mod.inviteByEmail(priv.id, owner.id, m3.email);
      expect(i2).toEqual({ ok: true, userId: expect.any(String), suggestion: null });
      expect(i3.ok && i3.suggestion === null).toBe(true);
      const i4 = await mod.inviteByEmail(priv.id, owner.id, m4.email);
      expect(i4.ok && i4.suggestion?.to_mode === "queue" && i4.suggestion.accepted === null).toBe(true);
      const { data: r } = await mod.admin.from("rooms").select("mode").eq("id", priv.id).single();
      expect(r?.mode).toBe("freeform"); // suggested, not forced
      const notOwner = await mod.inviteByEmail(priv.id, m2.id, m3.email);
      expect(notOwner.ok).toBe(false);
    } finally {
      await mod.admin.from("rooms").delete().eq("id", priv.id);
    }
  }, 30_000);
it("world rooms: freeform private applies instantly; public revert undoes the patch and appeal restores it", async () => {
    const owner = await mkUser("w");
    await mod.grant({ userId: owner.id, kind: "image", amount: 400, reason: "test" });
    const afterRooms = 400 - ROOM_COST_CREDITS.world;
    const priv = await mod.createRoom({ ownerId: owner.id, name: `w-${run}`, type: "world", visibility: "private", worldPrompt: "a neon city" });
    try {
      expect(priv.world).toBeTruthy();
      // New city worlds arrive pre-seeded with starter content per district.
      const seeded = (priv.world as unknown as { entities: unknown[] }).entities.length;
      expect(seeded).toBeGreaterThan(0);
      const r = await mod.submit({ userId: owner.id, roomId: priv.id, prompt: "open a cafe downtown", lane: "base" });
      expect(r).toMatchObject({ ok: true, applied: true });
      const { data: room } = await mod.admin.from("rooms").select("world").eq("id", priv.id).single();
      const world = room?.world as unknown as { entities: Array<{ name: string; kind: string }> };
      expect(world.entities).toHaveLength(seeded + 1);
      expect(world.entities[world.entities.length - 1]).toMatchObject({ kind: "building", name: "cafe" });
      expect((await mod.getBalances(owner.id)).image.paid).toBe(afterRooms - 1);
      const bad = await mod.submit({ userId: owner.id, roomId: priv.id, prompt: "vibes only", lane: "base" });
      expect(bad).toMatchObject({ ok: true, applied: true }); // accepted at submit time…
      const { data: rejected } = await mod.admin.from("queue_submissions").select("status").eq("id", (bad as { submissionId: string }).submissionId).single();
      expect(rejected?.status).toBe("rejected"); // …but the planner rejects it and refunds
      expect((await mod.getBalances(owner.id)).image.paid).toBe(afterRooms - 1);
    } finally {
      await mod.admin.from("rooms").delete().eq("id", priv.id);
    }

    // Public world: downvotes revert the patch, appeal restores it.
    const pub = await mod.createRoom({ ownerId: owner.id, name: `pw-${run}`, type: "world", visibility: "public", worldPrompt: "desert town" });
    try {
      const s1 = await mod.submit({ userId: owner.id, roomId: pub.id, prompt: "spawn three zombies", lane: "instant" });
      expect(s1).toMatchObject({ ok: true, applied: true });
      const sid = (s1 as { submissionId: string }).submissionId;
      const seededPub = (pub.world as unknown as { entities: unknown[] }).entities.length;
      const count = async () => ((await mod.admin.from("rooms").select("world").eq("id", pub.id).single()).data?.world as unknown as { entities: unknown[] }).entities.length;
      expect(await count()).toBe(seededPub + 3);
      const v1 = await mkUser("v1", { score: 0.3 });
      const v2 = await mkUser("v2", { score: 0.3 });
      const v3 = await mkUser("v3", { score: 0.3 });
      await mod.admin.from("reputation_scores").update({ score: 1.0 }).in("user_id", [v1.id, v2.id, v3.id]);
      for (const u of [v1, v2, v3]) await mod.downvote(u.id, sid);
      expect(await count()).toBe(seededPub);
      await mod.admin.from("moderation_flags").update({ weight: 0.3 }).eq("submission_id", sid);
      const ap = await mod.appeal(owner.id, sid);
      expect(ap.ok && ap.verdict.brigading).toBe(true);
      expect(await count()).toBe(seededPub + 3);
    } finally {
      await mod.admin.from("rooms").delete().eq("id", pub.id);
    }
  }, 30_000);
});
