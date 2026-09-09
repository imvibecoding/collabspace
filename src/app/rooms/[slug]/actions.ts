"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { submit } from "@/lib/queue/service";
import { appeal, downvote } from "@/lib/reputation/service";
import { createSnapshot, inviteByEmail, resolveModeSuggestion, setRoomMode } from "@/lib/rooms/service";
import { forkSnapshot } from "@/lib/world/service";
import { redirect } from "next/navigation";
import type { Enums } from "@/lib/supabase/types";

export type ActionState = { ok?: boolean; error?: string; message?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/* ----------------------------- Art room ---------------------------------- */

export async function submitPromptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireUser();
  if (!user) return { error: "Sign in to submit" };
  const roomId = String(formData.get("room_id"));
  const slug = String(formData.get("slug"));
  const laneRaw = String(formData.get("lane") ?? "base");
  const lane = laneRaw === "premium" || laneRaw === "instant" ? laneRaw : "base";
  const result = await submit({
    userId: user.id,
    roomId,
    prompt: String(formData.get("prompt") ?? ""),
    lane,
    bidCredits: Number(formData.get("bid") ?? 0),
    providerKey: String(formData.get("provider") ?? "mock"),
  });
  revalidatePath(`/rooms/${slug}`);
  if (!result.ok) return { error: result.message };
  return { ok: true, message: result.applied ? "Applied instantly" : "Queued for this window" };
}

export async function downvoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireUser();
  if (!user) return { error: "Sign in to vote" };
  const r = await downvote(user.id, String(formData.get("submission_id")));
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
  if (!r.ok) return { error: r.message };
  return { ok: true, message: r.reverted ? "Change reverted by the community" : `Downvoted (weight ${r.totalWeight.toFixed(1)})` };
}

export async function appealAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireUser();
  if (!user) return { error: "Sign in" };
  const r = await appeal(user.id, String(formData.get("submission_id")));
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
  if (!r.ok) return { error: r.message };
  return {
    ok: true,
    message: r.verdict.brigading
      ? `Appeal upheld: brigading detected (${r.verdict.signals.join("; ")}). Your change is restored.`
      : `Appeal rejected: the downvotes look organic (${r.verdict.signals.join("; ") || "no coordination signals"}).`,
  };
}

export async function snapshotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireUser();
  if (!user) return { error: "Sign in" };
  const paid = formData.get("paid") === "1";
  const r = await createSnapshot(user.id, String(formData.get("room_id")), { paid });
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
  if (!r.ok) return { error: r.message };
  return { ok: true, message: `${paid ? "Print" : "Snapshot"} ready: /s/${r.snapshot.id}` };
}

export async function forkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireUser();
  if (!user) return { error: "Sign in" };
  const r = await forkSnapshot(user.id, String(formData.get("snapshot_id")), String(formData.get("name") ?? ""));
  if (!r.ok) return { error: r.message };
  redirect(`/rooms/${r.room.slug}`);
}

/* ----------------------------- Shared ------------------------------------ */

export async function inviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireUser();
  if (!user) return { error: "Sign in" };
  const r = await inviteByEmail(String(formData.get("room_id")), user.id, String(formData.get("email") ?? ""));
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
  if (!r.ok) return { error: r.message };
  return { ok: true, message: r.suggestion ? "Invited. The room suggests a mode change." : "Invited." };
}

export async function modeSuggestionAction(formData: FormData) {
  const { user } = await requireUser();
  if (!user) return;
  await resolveModeSuggestion(user.id, Number(formData.get("suggestion_id")), formData.get("accept") === "1");
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
}

export async function setModeAction(formData: FormData) {
  const { user } = await requireUser();
  if (!user) return;
  const mode = String(formData.get("mode")) as Enums<"collab_mode">;
  if (!["freeform", "queue", "sectioned"].includes(mode)) return;
  await setRoomMode(user.id, String(formData.get("room_id")), mode);
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
}

/* ----------------------------- Kanban ------------------------------------ */
/* These go through the user's own client so RLS (incl. lock ownership) is enforced. */

async function logKanban(roomId: string, actorId: string, action: string, targetId: string, payload = {}) {
  const supabase = await createClient();
  await supabase.from("action_history").insert({ room_id: roomId, actor_id: actorId, action, target_type: "card", target_id: targetId, payload });
}

export async function addCardAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in" };
  const roomId = String(formData.get("room_id"));
  const columnId = String(formData.get("column_id"));
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Title required" };
  const { data: last } = await supabase.from("kanban_cards").select("position").eq("column_id", columnId).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase
    .from("kanban_cards")
    .insert({ room_id: roomId, column_id: columnId, title, position: (last?.position ?? -1) + 1, created_by: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await logKanban(roomId, user.id, "card.created", data.id, { title });
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
  return { ok: true };
}

export async function toggleLockAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  if (!user) return;
  const cardId = String(formData.get("card_id"));
  const roomId = String(formData.get("room_id"));
  const lock = formData.get("lock") === "1";
  if (lock) {
    // Turn/queue mode: only one card may be locked in the room at a time.
    const { data: room } = await supabase.from("rooms").select("mode").eq("id", roomId).single();
    if (room?.mode === "queue") {
      const { data: others } = await supabase.from("kanban_cards").select("id").eq("room_id", roomId).not("locked_by", "is", null).neq("locked_by", user.id).limit(1);
      if (others && others.length > 0) return;
    }
    const { data } = await supabase
      .from("kanban_cards")
      .update({ locked_by: user.id, locked_at: new Date().toISOString() })
      .eq("id", cardId)
      .is("locked_by", null)
      .select("id");
    if (data && data.length > 0) await logKanban(roomId, user.id, "card.locked", cardId);
  } else {
    const { data } = await supabase.from("kanban_cards").update({ locked_by: null, locked_at: null }).eq("id", cardId).eq("locked_by", user.id).select("id");
    if (data && data.length > 0) await logKanban(roomId, user.id, "card.unlocked", cardId);
  }
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
}

export async function updateCardAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in" };
  const cardId = String(formData.get("card_id"));
  const roomId = String(formData.get("room_id"));
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim() || null;
  if (!title) return { error: "Title required" };
  const { data, error } = await supabase.from("kanban_cards").update({ title, body }).eq("id", cardId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Card is locked by someone else" };
  await logKanban(roomId, user.id, "card.updated", cardId, { title });
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
  return { ok: true };
}

export async function moveCardAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  if (!user) return;
  const cardId = String(formData.get("card_id"));
  const roomId = String(formData.get("room_id"));
  const columnId = String(formData.get("column_id"));
  const { data: last } = await supabase.from("kanban_cards").select("position").eq("column_id", columnId).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data } = await supabase.from("kanban_cards").update({ column_id: columnId, position: (last?.position ?? -1) + 1 }).eq("id", cardId).select("id");
  if (data && data.length > 0) await logKanban(roomId, user.id, "card.moved", cardId, { column_id: columnId });
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
}

export async function deleteCardAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  if (!user) return;
  const cardId = String(formData.get("card_id"));
  const roomId = String(formData.get("room_id"));
  const { data } = await supabase.from("kanban_cards").delete().eq("id", cardId).select("id");
  if (data && data.length > 0) await logKanban(roomId, user.id, "card.deleted", cardId);
  revalidatePath(`/rooms/${String(formData.get("slug"))}`);
}
