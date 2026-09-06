import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/types";
import type { Json } from "@/lib/supabase/database.types";
import { InsufficientCreditsError, spend, refundSubmission } from "@/lib/credits/ledger";
import { filterPrompt, type RoomRules } from "@/lib/moderation/prompt-filter";
import { getImageProvider } from "@/lib/providers/image";
import {
  resolveWindow,
  submissionCost,
  validateBid,
  windowStart,
  type Lane,
  type PendingSubmission,
  type QueueRoomConfig,
} from "./engine";

type Room = Tables<"rooms">;
type Submission = Tables<"queue_submissions">;

export function roomQueueConfig(room: Room): QueueRoomConfig {
  return {
    baseWindowSeconds: room.base_window_seconds,
    premiumWindowSeconds: room.premium_window_seconds,
    basePriceCredits: room.base_price_credits,
    premiumMinBidCredits: room.premium_min_bid_credits,
    premiumBidIncrementCredits: room.premium_bid_increment_credits,
    instantPriceCredits: room.instant_price_credits,
  };
}

export type SubmitResult =
  | { ok: true; submissionId: string; applied: boolean }
  | { ok: false; code: "forbidden" | "cooldown" | "moderation" | "bid" | "credits" | "room"; message: string };

async function logHistory(
  roomId: string,
  actorId: string | null,
  action: string,
  target: { type: string; id: string } | null,
  payload: Json = {},
) {
  const admin = createAdminClient();
  await admin.from("action_history").insert({
    room_id: roomId,
    actor_id: actorId,
    action,
    target_type: target?.type ?? null,
    target_id: target?.id ?? null,
    payload,
  });
}

export async function submit(input: {
  userId: string;
  roomId: string;
  prompt: string;
  lane: Lane;
  bidCredits?: number;
  providerKey?: string | null;
}): Promise<SubmitResult> {
  const admin = createAdminClient();
  const { data: room } = await admin.from("rooms").select("*").eq("id", input.roomId).single();
  if (!room || room.type !== "art") return { ok: false, code: "room", message: "Room not found" };

  // Access: public rooms accept anyone signed in; private rooms need membership.
  if (room.visibility === "private" && room.owner_id !== input.userId) {
    const { data: member } = await admin
      .from("room_participants")
      .select("user_id")
      .eq("room_id", room.id)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (!member) return { ok: false, code: "forbidden", message: "You are not a member of this room" };
  }

  // Reputation cooldown + priority penalty.
  const { data: rep } = await admin
    .from("reputation_scores")
    .select("cooldown_until, priority_penalty")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (rep?.cooldown_until && new Date(rep.cooldown_until) > new Date()) {
    return {
      ok: false,
      code: "cooldown",
      message: `You are on cooldown until ${new Date(rep.cooldown_until).toLocaleTimeString()}`,
    };
  }

  // Moderation stack, layer 1 + room rules.
  const mod = await filterPrompt(input.prompt, (room.rules ?? {}) as RoomRules);
  if (!mod.allowed) return { ok: false, code: "moderation", message: mod.reason };

  const config = roomQueueConfig(room);
  const now = new Date();
  const lane = input.lane;
  const bid = lane === "premium" ? Math.floor(input.bidCredits ?? 0) : 0;
  const wStart =
    lane === "instant"
      ? now
      : windowStart(now, lane === "base" ? config.baseWindowSeconds : config.premiumWindowSeconds);

  if (lane === "premium") {
    const { data: top } = await admin
      .from("queue_submissions")
      .select("bid_credits")
      .eq("room_id", room.id)
      .eq("lane", "premium")
      .eq("status", "pending")
      .eq("window_start", wStart.toISOString())
      .order("bid_credits", { ascending: false })
      .limit(1)
      .maybeSingle();
    const v = validateBid(config, bid, top?.bid_credits ?? null);
    if (!v.ok) return { ok: false, code: "bid", message: v.reason };
  }

  const provider = getImageProvider(input.providerKey);
  const cost = submissionCost(config, lane, bid);

  const { data: sub, error: insErr } = await admin
    .from("queue_submissions")
    .insert({
      room_id: room.id,
      user_id: input.userId,
      lane,
      prompt: mod.normalized,
      provider: provider.key,
      bid_credits: bid,
      status: "pending",
      window_start: wStart.toISOString(),
      moderation: { passed: true, layers: ["blocklist", "room_rules"] },
    })
    .select("*")
    .single();
  if (insErr || !sub) return { ok: false, code: "room", message: insErr?.message ?? "Could not submit" };

  try {
    await spend({
      userId: input.userId,
      kind: "image",
      amount: cost,
      reason: `queue_${lane}`,
      roomId: room.id,
      submissionId: sub.id,
      providerCostCents: provider.estimateCostCents({ prompt: mod.normalized }),
    });
  } catch (e) {
    await admin.from("queue_submissions").delete().eq("id", sub.id);
    if (e instanceof InsufficientCreditsError) {
      return { ok: false, code: "credits", message: `Not enough credits (short ${e.shortfall})` };
    }
    throw e;
  }

  await logHistory(room.id, input.userId, "submission.created", { type: "submission", id: sub.id }, { lane, bid, prompt: mod.normalized });

  if (lane === "instant") {
    await applySubmission(sub, room);
    return { ok: true, submissionId: sub.id, applied: true };
  }
  return { ok: true, submissionId: sub.id, applied: false };
}

/** Generate the asset for a winning submission and make it the room's current state. */
export async function applySubmission(sub: Submission, room: Room): Promise<void> {
  const admin = createAdminClient();
  const provider = getImageProvider(sub.provider);
  let asset;
  try {
    asset = await provider.generate({ prompt: sub.prompt, baseImageUrl: room.current_asset_url });
  } catch (e) {
    await admin
      .from("queue_submissions")
      .update({ status: "rejected", moderation: { ...(sub.moderation as object), error: (e as Error).message } })
      .eq("id", sub.id);
    await refundSubmission(sub.id, "generation_failed");
    await logHistory(room.id, null, "submission.failed", { type: "submission", id: sub.id }, { error: (e as Error).message });
    return;
  }
  const appliedAt = new Date().toISOString();
  await admin
    .from("queue_submissions")
    .update({ status: "applied", applied_at: appliedAt, result_asset_url: asset.url })
    .eq("id", sub.id);
  await admin
    .from("rooms")
    .update({ current_asset_url: asset.url, current_submission_id: sub.id })
    .eq("id", room.id);
  await logHistory(room.id, sub.user_id, "submission.applied", { type: "submission", id: sub.id }, {
    lane: sub.lane,
    prompt: sub.prompt,
    provider: asset.provider,
    model: asset.model,
    provider_cost_cents: asset.providerCostCents,
  });
}

/**
 * Resolve every window that has closed. Called from the tick endpoint (cron)
 * and opportunistically when a room page loads. Idempotent.
 */
export async function resolveDueWindows(roomId?: string): Promise<{ applied: number; refunded: number }> {
  const admin = createAdminClient();
  let roomsQuery = admin.from("rooms").select("*").eq("type", "art");
  if (roomId) roomsQuery = roomsQuery.eq("id", roomId);
  const { data: rooms } = await roomsQuery;
  const totals = { applied: 0, refunded: 0 };
  const now = Date.now();

  for (const room of rooms ?? []) {
    const { data: pending } = await admin
      .from("queue_submissions")
      .select("*")
      .eq("room_id", room.id)
      .eq("status", "pending")
      .in("lane", ["base", "premium"])
      .order("window_start", { ascending: true });
    if (!pending || pending.length === 0) continue;

    const due = pending.filter((s) => {
      const len = s.lane === "base" ? room.base_window_seconds : room.premium_window_seconds;
      return new Date(s.window_start).getTime() + len * 1000 <= now;
    });
    if (due.length === 0) continue;

    // Reputation penalties for weighting the base lottery.
    const userIds = [...new Set(due.map((s) => s.user_id))];
    const { data: reps } = await admin
      .from("reputation_scores")
      .select("user_id, priority_penalty")
      .in("user_id", userIds);
    const penalty = new Map((reps ?? []).map((r) => [r.user_id, r.priority_penalty]));

    const byWindow = new Map<string, Submission[]>();
    for (const s of due) {
      const list = byWindow.get(s.window_start) ?? [];
      list.push(s);
      byWindow.set(s.window_start, list);
    }

    let current = room;
    for (const key of [...byWindow.keys()].sort()) {
      const subs = byWindow.get(key)!;
      const pendingInput: PendingSubmission[] = subs.map((s) => ({
        id: s.id,
        userId: s.user_id,
        lane: s.lane as Lane,
        bidCredits: s.bid_credits,
        createdAt: new Date(s.created_at),
        priorityPenalty: penalty.get(s.user_id) ?? 0,
      }));
      const { applied, refunded } = resolveWindow(pendingInput);
      const byId = new Map(subs.map((s) => [s.id, s]));

      for (const win of applied) {
        const sub = byId.get(win.id)!;
        await applySubmission(sub, current);
        const { data: fresh } = await admin.from("rooms").select("*").eq("id", room.id).single();
        if (fresh) current = fresh;
        totals.applied += 1;
      }
      for (const lost of refunded) {
        await admin.from("queue_submissions").update({ status: "expired" }).eq("id", lost.id);
        await refundSubmission(lost.id);
        totals.refunded += 1;
      }
    }
  }
  return totals;
}
