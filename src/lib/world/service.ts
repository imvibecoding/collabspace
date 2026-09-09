import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { Tables } from "@/lib/supabase/types";
import { refundSubmission } from "@/lib/credits/ledger";
import { getBaseWorldGenerator, getSpriteGenerator } from "./generators";
import { applyPatch } from "./patch";
import { HeuristicPlanner, PlanError, type WorldPlanner } from "./planner";
import { DEFAULT_WORLD_SIZE, emptyWorld, type WorldPatch, type WorldState } from "./types";
import { melbourneSeedPrompts, melbourneZones } from "./zones";

type Room = Tables<"rooms">;
type Submission = Tables<"queue_submissions">;

let planner: WorldPlanner = new HeuristicPlanner();
/** Swap in an LLM-backed planner later without touching room code. */
export function setWorldPlanner(p: WorldPlanner) {
  planner = p;
}

/** Backfill fields added after some worlds were already saved (zones, entity height). */
export function normalizeWorld(raw: WorldState | null | undefined): WorldState | null {
  if (!raw) return null;
  return {
    ...raw,
    zones: raw.zones ?? [],
    entities: raw.entities.map((e) => ({ ...e, height: e.height ?? 0 })),
  };
}

export function roomWorld(room: Room): WorldState | null {
  return normalizeWorld(room.world as unknown as WorldState | null);
}

async function history(roomId: string, actorId: string | null, action: string, targetId: string | null, payload: Json = {}) {
  const admin = createAdminClient();
  await admin.from("action_history").insert({
    room_id: roomId,
    actor_id: actorId,
    action,
    target_type: targetId ? "submission" : null,
    target_id: targetId,
    payload,
  });
}

/** Stamp texture identity + provenance onto a patch's new entities. Returns total generation cost. */
async function stampNewEntities(patch: WorldPatch, world: WorldState, extraMeta: Record<string, unknown>): Promise<number> {
  const sprites = getSpriteGenerator();
  let costCents = 0;
  for (const op of patch.ops) {
    if (op.op !== "add") continue;
    const s = await sprites.generate(op.entity, world);
    costCents += s.providerCostCents;
    op.entity = { ...op.entity, spriteUrl: s.spriteUrl, meta: { ...op.entity.meta, ...extraMeta } };
  }
  return costCents;
}

/**
 * Lazily create the base world for a world room (from the owner's world
 * prompt) the first time it's needed. Seeded rooms rely on this. City worlds
 * (rules.city) get the Melbourne-style district layout plus a handful of
 * starter prompts run through the same planner, so each district already has
 * character before a real visitor submits anything.
 */
export async function ensureWorld(room: Room): Promise<{ room: Room; world: WorldState }> {
  const existing = roomWorld(room);
  if (existing) return { room, world: existing };
  const admin = createAdminClient();
  const rules = (room.rules ?? {}) as { world_prompt?: string; city?: boolean };
  const prompt = rules.world_prompt?.trim() || room.name;
  const isCity = Boolean(rules.city);
  const zones = isCity ? melbourneZones(DEFAULT_WORLD_SIZE) : [];
  const gen = getBaseWorldGenerator();
  const base = await gen.generate(prompt, zones);
  let world: WorldState = { ...emptyWorld(base.theme), backgroundUrl: base.backgroundUrl, zones, citySeed: isCity ? room.id : undefined };

  if (isCity) {
    for (const seed of melbourneSeedPrompts()) {
      try {
        const patch = await planner.plan(seed.prompt, { state: world });
        await stampNewEntities(patch, world, { seeded: true, zoneId: seed.zoneId });
        world = applyPatch(world, patch).state;
      } catch {
        // A seed prompt failing to ground shouldn't block world creation.
      }
    }
  }

  const { data: updated } = await admin
    .from("rooms")
    .update({
      world: world as unknown as Json,
      world_initial: world as unknown as Json,
      current_asset_url: base.backgroundUrl,
    })
    .eq("id", room.id)
    .is("world", null)
    .select("*")
    .maybeSingle();
  if (updated) {
    await history(room.id, room.owner_id, "world.created", null, {
      prompt,
      generator: gen.key,
      theme: base.theme,
      provider_cost_cents: base.providerCostCents,
      city: isCity,
      zones: zones.map((z) => z.id),
      seeded_entities: world.entities.length,
    });
    return { room: updated, world };
  }
  // Someone else initialised it concurrently; reload.
  const { data: fresh } = await admin.from("rooms").select("*").eq("id", room.id).single();
  return { room: fresh ?? room, world: roomWorld(fresh ?? room) ?? world };
}

/** Plan + apply a winning world submission. Mirrors applySubmission for art rooms. */
export async function applyWorldSubmission(sub: Submission, roomIn: Room): Promise<void> {
  const admin = createAdminClient();
  const { room, world } = await ensureWorld(roomIn);

  let patch: WorldPatch;
  try {
    patch = await planner.plan(sub.prompt, { state: world });
  } catch (e) {
    const message = e instanceof PlanError ? e.message : (e as Error).message;
    await admin
      .from("queue_submissions")
      .update({ status: "rejected", moderation: { ...(sub.moderation as object), error: message } })
      .eq("id", sub.id);
    await refundSubmission(sub.id, "plan_failed");
    await history(room.id, sub.user_id, "submission.failed", sub.id, { error: message, prompt: sub.prompt });
    return;
  }

  const costCents = await stampNewEntities(patch, world, { submissionId: sub.id, userId: sub.user_id });

  const { state, inverse } = applyPatch(world, patch);
  const appliedAt = new Date().toISOString();
  await admin
    .from("queue_submissions")
    .update({ status: "applied", applied_at: appliedAt, patch: { patch, inverse } as unknown as Json })
    .eq("id", sub.id);
  await admin
    .from("rooms")
    .update({ world: state as unknown as Json, current_submission_id: sub.id })
    .eq("id", room.id);
  await history(room.id, sub.user_id, "submission.applied", sub.id, {
    lane: sub.lane,
    prompt: sub.prompt,
    summary: patch.summary,
    ops: patch.ops.length,
    provider_cost_cents: costCents,
  });
}

function storedPatch(sub: Submission): { patch: WorldPatch; inverse: WorldPatch } | null {
  const p = sub.patch as unknown as { patch?: WorldPatch; inverse?: WorldPatch } | null;
  return p?.patch && p?.inverse ? { patch: p.patch, inverse: p.inverse } : null;
}

/** Undo a world submission by applying its stored inverse patch. */
export async function revertWorldSubmission(sub: Submission): Promise<boolean> {
  const stored = storedPatch(sub);
  if (!stored) return false;
  const admin = createAdminClient();
  const { data: room } = await admin.from("rooms").select("*").eq("id", sub.room_id).single();
  const world = room ? roomWorld(room) : null;
  if (!room || !world) return false;
  const { state } = applyPatch(world, stored.inverse);
  await admin.from("rooms").update({ world: state as unknown as Json }).eq("id", room.id);
  return true;
}

/** Re-apply a previously reverted world submission (appeal upheld). */
export async function restoreWorldSubmission(sub: Submission): Promise<boolean> {
  const stored = storedPatch(sub);
  if (!stored) return false;
  const admin = createAdminClient();
  const { data: room } = await admin.from("rooms").select("*").eq("id", sub.room_id).single();
  const world = room ? roomWorld(room) : null;
  if (!room || !world) return false;
  const { state } = applyPatch(world, stored.patch);
  await admin.from("rooms").update({ world: state as unknown as Json, current_submission_id: sub.id }).eq("id", room.id);
  return true;
}

/** Applied world patches in order, for timelapse replay. */
export async function worldTimeline(roomId: string, limit = 300) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("queue_submissions")
    .select("id, prompt, applied_at, user_id, status, patch, profiles(display_name)")
    .eq("room_id", roomId)
    .eq("status", "applied")
    .not("patch", "is", null)
    .order("applied_at", { ascending: true })
    .limit(limit);
  return (data ?? []).map((s) => {
    const p = s.patch as unknown as { patch: WorldPatch };
    return {
      id: s.id,
      prompt: s.prompt,
      appliedAt: s.applied_at,
      userId: s.user_id,
      author: (s.profiles as { display_name: string | null } | null)?.display_name ?? "someone",
      summary: p.patch.summary,
      patch: p.patch,
    };
  });
}

/*
 * Forking is deliberately not offered: worlds stay on collabspace rather than
 * being copied out into private spin-offs. Snapshots (read-only, on-site) are
 * the sanctioned way to keep a moment.
 */

