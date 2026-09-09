import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Enums, Tables } from "@/lib/supabase/types";
import type { Json } from "@/lib/supabase/database.types";
import { spend, InsufficientCreditsError } from "@/lib/credits/ledger";
import { ensureWorld, roomWorld } from "@/lib/world/service";

/** Participant count at which we suggest moving from freeform to a queue mode. */
export const QUEUE_SUGGESTION_THRESHOLD = 4;
export const PRINT_PRICE_CREDITS = 5;

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "room"}-${Math.random().toString(36).slice(2, 7)}`;
}

async function history(roomId: string, actorId: string | null, action: string, target?: { type: string; id: string }, payload = {}) {
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

export async function createRoom(input: {
  ownerId: string;
  name: string;
  type: Enums<"room_type">;
  visibility: Enums<"room_visibility">;
  /** World rooms: the prompt that generates the base map. */
  worldPrompt?: string;
}): Promise<Tables<"rooms">> {
  const admin = createAdminClient();
  const isArt = input.type === "art";
  const isWorld = input.type === "world";
  const { data: room, error } = await admin
    .from("rooms")
    .insert({
      slug: slugify(input.name),
      name: input.name.trim().slice(0, 80),
      type: input.type,
      visibility: input.visibility,
      // Public rooms are always queue-based; private rooms start freeform (brief §2.4).
      // Card locking is always available in kanban rooms regardless of mode.
      mode: input.visibility === "public" ? "queue" : "freeform",
      owner_id: input.ownerId,
      rules: isArt ? { max_prompt_words: 6 } : isWorld ? { max_prompt_words: 12, world_prompt: (input.worldPrompt ?? input.name).trim().slice(0, 200) } : {},
    })
    .select("*")
    .single();
  if (error || !room) throw error ?? new Error("Could not create room");

  await admin.from("room_participants").insert({ room_id: room.id, user_id: input.ownerId, role: "owner" });
  if (input.type === "kanban") {
    await admin.from("kanban_columns").insert(
      ["To do", "Doing", "Done"].map((title, position) => ({ room_id: room.id, title, position })),
    );
  }
  await history(room.id, input.ownerId, "room.created", { type: "room", id: room.id }, { type: input.type, visibility: input.visibility });
  if (isWorld) return (await ensureWorld(room)).room;
  return room;
}

export type InviteResult = { ok: true; userId: string; suggestion: Tables<"room_mode_changes"> | null } | { ok: false; message: string };

export async function inviteByEmail(roomId: string, inviterId: string, email: string): Promise<InviteResult> {
  const admin = createAdminClient();
  const { data: room } = await admin.from("rooms").select("*").eq("id", roomId).single();
  if (!room || room.owner_id !== inviterId) return { ok: false, message: "Only the room owner can invite" };

  // Resolve email → user id via a security-definer DB function (profiles don't store email).
  const target = email.trim().toLowerCase();
  const { data: userId, error: lookupErr } = await admin.rpc("find_user_id_by_email", { p_email: target });
  if (lookupErr) return { ok: false, message: lookupErr.message };
  if (!userId) return { ok: false, message: "No account with that email yet. Ask them to sign up first." };
  if (userId === inviterId) return { ok: false, message: "You are already the owner." };

  const { error } = await admin
    .from("room_participants")
    .insert({ room_id: roomId, user_id: userId, role: "editor", invited_by: inviterId });
  if (error && error.code !== "23505") return { ok: false, message: error.message };
  await history(roomId, inviterId, "participant.invited", { type: "user", id: userId }, { email: target });

  const suggestion = await maybeSuggestModeChange(roomId);
  return { ok: true, userId, suggestion };
}

/**
 * Adaptive collab-mode engine (brief §2.4): suggest, never force. When the room
 * crosses the size threshold, suggest queue mode; when it drops back, suggest freeform.
 */
export async function maybeSuggestModeChange(roomId: string): Promise<Tables<"room_mode_changes"> | null> {
  const admin = createAdminClient();
  const { data: room } = await admin.from("rooms").select("*").eq("id", roomId).single();
  if (!room || room.visibility === "public") return null;
  const { count } = await admin
    .from("room_participants")
    .select("user_id", { count: "exact", head: true })
    .eq("room_id", roomId);
  const participants = count ?? 0;

  const { data: pending } = await admin
    .from("room_mode_changes")
    .select("*")
    .eq("room_id", roomId)
    .eq("suggested", true)
    .is("accepted", null)
    .maybeSingle();

  let target: Enums<"collab_mode"> | null = null;
  let reason = "";
  if (room.mode === "freeform" && participants >= QUEUE_SUGGESTION_THRESHOLD) {
    target = "queue";
    reason = `${participants} people are now in this room. Turn-based editing keeps larger groups from stepping on each other.`;
  } else if (room.mode === "queue" && participants < QUEUE_SUGGESTION_THRESHOLD) {
    target = "freeform";
    reason = `Only ${participants} people are in this room now. Freeform editing is simpler for small groups.`;
  }

  if (!target) return pending ?? null;
  if (pending && pending.to_mode === target) return pending;
  if (pending) await admin.from("room_mode_changes").update({ accepted: false }).eq("id", pending.id);

  const { data: created } = await admin
    .from("room_mode_changes")
    .insert({ room_id: roomId, from_mode: room.mode, to_mode: target, suggested: true, accepted: null, reason })
    .select("*")
    .single();
  await history(roomId, null, "mode.suggested", { type: "room", id: roomId }, { to: target, participants });
  return created ?? null;
}

export async function resolveModeSuggestion(userId: string, suggestionId: number, accept: boolean) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("room_mode_changes").select("*").eq("id", suggestionId).single();
  if (!s) return { ok: false as const, message: "Suggestion not found" };
  const { data: room } = await admin.from("rooms").select("owner_id, mode").eq("id", s.room_id).single();
  if (room?.owner_id !== userId) return { ok: false as const, message: "Only the owner can decide" };
  await admin.from("room_mode_changes").update({ accepted: accept, changed_by: userId }).eq("id", s.id);
  if (accept) {
    await admin.from("rooms").update({ mode: s.to_mode }).eq("id", s.room_id);
    await history(s.room_id, userId, "mode.changed", { type: "room", id: s.room_id }, { from: room?.mode, to: s.to_mode });
  } else {
    await history(s.room_id, userId, "mode.suggestion_declined", { type: "room", id: s.room_id }, { to: s.to_mode });
  }
  return { ok: true as const };
}

export async function setRoomMode(userId: string, roomId: string, mode: Enums<"collab_mode">) {
  const admin = createAdminClient();
  const { data: room } = await admin.from("rooms").select("owner_id, mode").eq("id", roomId).single();
  if (room?.owner_id !== userId) return { ok: false as const, message: "Only the owner can change the mode" };
  await admin.from("rooms").update({ mode }).eq("id", roomId);
  await admin.from("room_mode_changes").insert({ room_id: roomId, from_mode: room.mode, to_mode: mode, suggested: false, accepted: true, changed_by: userId });
  await history(roomId, userId, "mode.changed", { type: "room", id: roomId }, { from: room.mode, to: mode });
  return { ok: true as const };
}

/** Snapshot = frozen, shareable state. "Buy a print" is a paid snapshot. */
export async function createSnapshot(userId: string, roomId: string, opts: { paid: boolean }) {
  const admin = createAdminClient();
  const { data: room } = await admin.from("rooms").select("*").eq("id", roomId).single();
  if (!room) return { ok: false as const, message: "Room not found" };
  if (!room.current_asset_url) return { ok: false as const, message: "Nothing on the canvas yet" };
  if (opts.paid) {
    try {
      await spend({ userId, kind: "image", amount: PRINT_PRICE_CREDITS, reason: "print", roomId });
    } catch (e) {
      if (e instanceof InsufficientCreditsError) return { ok: false as const, message: `Not enough credits (short ${e.shortfall})` };
      throw e;
    }
  }
  const { data: snap, error } = await admin
    .from("snapshots")
    .insert({
      room_id: roomId,
      created_by: userId,
      asset_url: room.current_asset_url,
      state: {
        submission_id: room.current_submission_id,
        paid: opts.paid,
        room_name: room.name,
        ...(room.type === "world" ? { world: roomWorld(room) as unknown as Json } : {}),
      },
    })
    .select("*")
    .single();
  if (error || !snap) return { ok: false as const, message: error?.message ?? "Could not snapshot" };
  await history(roomId, userId, opts.paid ? "print.purchased" : "snapshot.created", { type: "snapshot", id: snap.id });
  return { ok: true as const, snapshot: snap };
}
