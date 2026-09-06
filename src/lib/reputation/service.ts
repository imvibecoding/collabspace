import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/types";

/** Weighted downvotes needed to revert the currently-applied change. */
export const REVERT_THRESHOLD = 3;

/** Escalation ladder (brief §2.6): revert → priority penalty → short cooldown → longer cooldown. */
export function penaltyForStrike(strike: number): { priorityPenalty: number; cooldownMinutes: number } {
  if (strike <= 1) return { priorityPenalty: 1, cooldownMinutes: 0 };
  if (strike === 2) return { priorityPenalty: 2, cooldownMinutes: 10 };
  if (strike === 3) return { priorityPenalty: 3, cooldownMinutes: 60 };
  return { priorityPenalty: 4, cooldownMinutes: 60 * 24 };
}

export type DownvoteResult =
  | { ok: true; totalWeight: number; reverted: boolean }
  | { ok: false; message: string };

async function history(roomId: string, actorId: string | null, action: string, targetId: string, payload = {}) {
  const admin = createAdminClient();
  await admin.from("action_history").insert({
    room_id: roomId,
    actor_id: actorId,
    action,
    target_type: "submission",
    target_id: targetId,
    payload,
  });
}

async function applyStrike(userId: string) {
  const admin = createAdminClient();
  const { data: rep } = await admin.from("reputation_scores").select("*").eq("user_id", userId).single();
  const strikes = (rep?.strikes ?? 0) + 1;
  const p = penaltyForStrike(strikes);
  const cooldown = p.cooldownMinutes ? new Date(Date.now() + p.cooldownMinutes * 60_000).toISOString() : null;
  await admin
    .from("reputation_scores")
    .upsert({
      user_id: userId,
      strikes,
      priority_penalty: Math.max(rep?.priority_penalty ?? 0, p.priorityPenalty),
      cooldown_until: cooldown,
      score: Math.max(0.1, (rep?.score ?? 1) * 0.8),
      updated_at: new Date().toISOString(),
    });
  return { strikes, ...p };
}

/** Revert an applied submission: restore the previous applied asset as the room's current state. */
export async function revertSubmission(sub: Tables<"queue_submissions">, actorId: string | null, reason: string) {
  const admin = createAdminClient();
  await admin
    .from("queue_submissions")
    .update({ status: "reverted", reverted_at: new Date().toISOString() })
    .eq("id", sub.id);
  const { data: room } = await admin.from("rooms").select("*").eq("id", sub.room_id).single();
  if (room?.current_submission_id === sub.id) {
    const { data: prev } = await admin
      .from("queue_submissions")
      .select("id, result_asset_url")
      .eq("room_id", sub.room_id)
      .eq("status", "applied")
      .neq("id", sub.id)
      .order("applied_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await admin
      .from("rooms")
      .update({ current_asset_url: prev?.result_asset_url ?? null, current_submission_id: prev?.id ?? null })
      .eq("id", sub.room_id);
  }
  await history(sub.room_id, actorId, "submission.reverted", sub.id, { reason });
}

export async function downvote(reporterId: string, submissionId: string, reason?: string): Promise<DownvoteResult> {
  const admin = createAdminClient();
  const { data: sub } = await admin.from("queue_submissions").select("*").eq("id", submissionId).single();
  if (!sub) return { ok: false, message: "Submission not found" };
  if (sub.status !== "applied") return { ok: false, message: "Only the currently applied change can be downvoted" };
  if (sub.user_id === reporterId) return { ok: false, message: "You cannot downvote your own change" };

  const { data: rep } = await admin.from("reputation_scores").select("score").eq("user_id", reporterId).maybeSingle();
  const weight = Number(rep?.score ?? 1);

  const { error } = await admin.from("moderation_flags").insert({
    room_id: sub.room_id,
    submission_id: sub.id,
    reporter_id: reporterId,
    kind: "downvote",
    weight,
    reason: reason ?? null,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "You already downvoted this change" };
    return { ok: false, message: error.message };
  }

  const { data: flags } = await admin
    .from("moderation_flags")
    .select("weight")
    .eq("submission_id", sub.id)
    .eq("kind", "downvote")
    .eq("status", "open");
  const totalWeight = (flags ?? []).reduce((a, f) => a + Number(f.weight), 0);

  if (totalWeight >= REVERT_THRESHOLD) {
    await revertSubmission(sub, null, "community_downvotes");
    const strike = await applyStrike(sub.user_id);
    await history(sub.room_id, null, "user.penalised", sub.id, { user_id: sub.user_id, ...strike });
    return { ok: true, totalWeight, reverted: true };
  }
  return { ok: true, totalWeight, reverted: false };
}

/* ------------------------------------------------------------------------- */
/* Appeals                                                                    */
/* ------------------------------------------------------------------------- */

export interface AppealEvidence {
  submission: Tables<"queue_submissions">;
  authorStrikes: number;
  flags: Array<{ reporter_id: string; weight: number; created_at: string; otherActivityInRoom: number }>;
}

export interface AppealVerdict {
  brigading: boolean;
  confidence: number;
  signals: string[];
}

export interface AppealReviewer {
  review(evidence: AppealEvidence): Promise<AppealVerdict>;
}

/**
 * Cheap rule-based reviewer. Looks at both sides: the flagged user's history and
 * the pattern of who downvoted. Swap for a purpose-tuned model later by
 * implementing `AppealReviewer`.
 */
export class HeuristicAppealReviewer implements AppealReviewer {
  async review(e: AppealEvidence): Promise<AppealVerdict> {
    const signals: string[] = [];
    const times = e.flags.map((f) => new Date(f.created_at).getTime()).sort((a, b) => a - b);
    const spreadMs = times.length > 1 ? times[times.length - 1] - times[0] : 0;
    if (e.flags.length >= 3 && spreadMs <= 120_000) signals.push("burst: all downvotes within 2 minutes");
    const avgWeight = e.flags.reduce((a, f) => a + f.weight, 0) / Math.max(1, e.flags.length);
    if (avgWeight < 0.6) signals.push("low-reputation downvoters");
    const inactive = e.flags.filter((f) => f.otherActivityInRoom === 0).length;
    if (e.flags.length > 0 && inactive / e.flags.length >= 0.7) signals.push("downvoters have no other activity in room");
    if (e.authorStrikes <= 1) signals.push("author has a clean history");
    // Author history alone is not evidence of brigading; need at least two coordination signals.
    const coordination = signals.filter((s) => !s.startsWith("author")).length;
    const brigading = coordination >= 2;
    return { brigading, confidence: Math.min(1, coordination / 3), signals };
  }
}

export type AppealResult = { ok: true; verdict: AppealVerdict } | { ok: false; message: string };

export async function appeal(
  userId: string,
  submissionId: string,
  reviewer: AppealReviewer = new HeuristicAppealReviewer(),
): Promise<AppealResult> {
  const admin = createAdminClient();
  const { data: sub } = await admin.from("queue_submissions").select("*").eq("id", submissionId).single();
  if (!sub) return { ok: false, message: "Submission not found" };
  if (sub.user_id !== userId) return { ok: false, message: "Only the author can appeal" };
  if (sub.status !== "reverted") return { ok: false, message: "Only reverted changes can be appealed" };

  const { data: flags } = await admin
    .from("moderation_flags")
    .select("id, reporter_id, weight, created_at, status")
    .eq("submission_id", sub.id)
    .eq("kind", "downvote");
  if (!flags || flags.length === 0) return { ok: false, message: "Nothing to appeal" };
  if (flags.some((f) => f.status !== "open")) return { ok: false, message: "This change was already reviewed" };

  const reporterIds = flags.map((f) => f.reporter_id);
  const { data: activity } = await admin
    .from("action_history")
    .select("actor_id")
    .eq("room_id", sub.room_id)
    .in("actor_id", reporterIds);
  const activityCount = new Map<string, number>();
  for (const a of activity ?? []) {
    if (a.actor_id) activityCount.set(a.actor_id, (activityCount.get(a.actor_id) ?? 0) + 1);
  }
  const { data: authorRep } = await admin.from("reputation_scores").select("strikes").eq("user_id", sub.user_id).maybeSingle();

  const verdict = await reviewer.review({
    submission: sub,
    authorStrikes: authorRep?.strikes ?? 0,
    flags: flags.map((f) => ({
      reporter_id: f.reporter_id,
      weight: Number(f.weight),
      created_at: f.created_at,
      otherActivityInRoom: activityCount.get(f.reporter_id) ?? 0,
    })),
  });

  if (verdict.brigading) {
    // Flip the penalty onto the pile-on, restore the author.
    await admin.from("moderation_flags").update({ status: "dismissed" }).eq("submission_id", sub.id);
    const { data: rep } = await admin.from("reputation_scores").select("*").eq("user_id", sub.user_id).single();
    if (rep) {
      await admin
        .from("reputation_scores")
        .update({
          strikes: Math.max(0, rep.strikes - 1),
          priority_penalty: Math.max(0, rep.priority_penalty - 1),
          cooldown_until: null,
          score: Math.min(2, Number(rep.score) / 0.8),
        })
        .eq("user_id", sub.user_id);
    }
    for (const rid of reporterIds) {
      const { data: r } = await admin.from("reputation_scores").select("*").eq("user_id", rid).maybeSingle();
      await admin.from("reputation_scores").upsert({
        user_id: rid,
        score: Math.max(0.1, Number(r?.score ?? 1) * 0.5),
        strikes: (r?.strikes ?? 0) + 1,
        priority_penalty: (r?.priority_penalty ?? 0) + 1,
        updated_at: new Date().toISOString(),
      });
    }
    // Restore the change if nothing newer has been applied since.
    const { data: room } = await admin.from("rooms").select("current_submission_id").eq("id", sub.room_id).single();
    const { data: newer } = await admin
      .from("queue_submissions")
      .select("id")
      .eq("room_id", sub.room_id)
      .eq("status", "applied")
      .gt("applied_at", sub.applied_at ?? sub.created_at)
      .limit(1);
    await admin.from("queue_submissions").update({ status: "applied", reverted_at: null }).eq("id", sub.id);
    if (!newer || newer.length === 0 || !room?.current_submission_id) {
      await admin
        .from("rooms")
        .update({ current_asset_url: sub.result_asset_url, current_submission_id: sub.id })
        .eq("id", sub.room_id);
    }
    await history(sub.room_id, null, "appeal.upheld", sub.id, { signals: verdict.signals, penalised: reporterIds });
  } else {
    await admin.from("moderation_flags").update({ status: "upheld" }).eq("submission_id", sub.id);
    await history(sub.room_id, null, "appeal.rejected", sub.id, { signals: verdict.signals });
  }
  return { ok: true, verdict };
}
