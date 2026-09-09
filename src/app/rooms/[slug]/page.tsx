import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDueWindows } from "@/lib/queue/service";
import { ensureMonthlyGrant, getBalances } from "@/lib/credits/ledger";
import { listImageProviders } from "@/lib/providers/image";
import { REVERT_THRESHOLD } from "@/lib/reputation/service";
import { windowStart } from "@/lib/queue/engine";
import { ensureWorld, worldTimeline } from "@/lib/world/service";
import type { WorldState } from "@/lib/world/types";
import { ArtRoom } from "@/components/art-room";
import { KanbanRoom } from "@/components/kanban-room";
import { WorldRoom } from "@/components/world-room";
import { RoomHeader } from "@/components/room-header";

export const dynamic = "force-dynamic";

const displayName = (p: { profiles?: unknown }) => (p.profiles as { display_name: string | null } | null)?.display_name ?? "someone";

export default async function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: roomLookup } = await supabase.from("rooms").select("id, type").eq("slug", slug).maybeSingle();
  if (!roomLookup) notFound();

  if (user) await ensureMonthlyGrant(user.id);

  // Opportunistic resolution keeps the room live even without the cron tick.
  if (roomLookup.type === "art" || roomLookup.type === "world") await resolveDueWindows(roomLookup.id);

  let { data: room } = await supabase.from("rooms").select("*").eq("id", roomLookup.id).single();
  if (!room) notFound();
  // Generate the base world before reading history so the creation entry shows on first load.
  const ensured = room.type === "world" ? await ensureWorld(room) : null;
  if (ensured) room = ensured.room;

  const [{ data: participants }, { data: history }, { data: pendingSuggestion }] = await Promise.all([
    supabase.from("room_participants").select("user_id, role, profiles!room_participants_user_id_fkey(display_name)").eq("room_id", room.id),
    supabase
      .from("action_history")
      .select("id, action, actor_id, payload, created_at, profiles(display_name)")
      .eq("room_id", room.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("room_mode_changes")
      .select("*")
      .eq("room_id", room.id)
      .eq("suggested", true)
      .is("accepted", null)
      .maybeSingle(),
  ]);

  const isOwner = user?.id === room.owner_id;
  const isMember = isOwner || (participants ?? []).some((p) => p.user_id === user?.id);
  const canParticipate = Boolean(user) && (room.visibility === "public" || isMember);

  const header = (
    <RoomHeader
      room={room}
      isOwner={isOwner}
      participants={(participants ?? []).map((p) => ({ userId: p.user_id, role: p.role, name: displayName(p) === "someone" ? "member" : displayName(p) }))}
      pendingSuggestion={pendingSuggestion ?? null}
    />
  );

  /* ------------------------------ Kanban ---------------------------------- */
  if (room.type === "kanban") {
    if (!isMember) notFound();
    const [{ data: columns }, { data: cards }] = await Promise.all([
      supabase.from("kanban_columns").select("*").eq("room_id", room.id).order("position"),
      supabase.from("kanban_cards").select("*, profiles!kanban_cards_locked_by_fkey(display_name)").eq("room_id", room.id).order("position"),
    ]);
    return (
      <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
        {header}
        <KanbanRoom
          room={room}
          userId={user!.id}
          columns={columns ?? []}
          cards={(cards ?? []).map((c) => ({ ...c, locked_by_name: (c.profiles as { display_name: string | null } | null)?.display_name ?? null }))}
          history={history ?? []}
        />
      </main>
    );
  }

  /* ------------------------ Shared queue-room data ------------------------- */
  const now = new Date();
  const windows = {
    base: windowStart(now, room.base_window_seconds).toISOString(),
    premium: windowStart(now, room.premium_window_seconds).toISOString(),
  };
  const [{ data: pending }, balances, { data: myReverted }] = await Promise.all([
    supabase
      .from("queue_submissions")
      .select("id, lane, prompt, bid_credits, user_id, window_start, created_at, profiles(display_name)")
      .eq("room_id", room.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    user ? getBalances(user.id) : Promise.resolve(null),
    user
      ? supabase
          .from("queue_submissions")
          .select("id, prompt, reverted_at")
          .eq("room_id", room.id)
          .eq("user_id", user.id)
          .eq("status", "reverted")
          .order("reverted_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] }),
  ]);
  const pendingView = (pending ?? []).map((p) => ({
    id: p.id,
    lane: p.lane,
    prompt: p.prompt,
    bid: p.bid_credits,
    mine: p.user_id === user?.id,
    author: displayName(p),
    windowStart: p.window_start,
  }));
  const balance = balances ? balances.image.free + balances.image.paid : null;

  /* ------------------------------- World ---------------------------------- */
  if (room.type === "world" && ensured) {
    const [timeline, { data: myFlags }, { data: latestSnap }] = await Promise.all([
      worldTimeline(room.id),
      user ? supabase.from("moderation_flags").select("submission_id").eq("room_id", room.id).eq("reporter_id", user.id) : Promise.resolve({ data: [] }),
      supabase.from("snapshots").select("id").eq("room_id", room.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return (
      <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
        {header}
        <WorldRoom
          room={room}
          world={ensured.world}
          initial={(room.world_initial as unknown as WorldState | null) ?? ensured.world}
          timeline={timeline}
          userId={user?.id ?? null}
          canParticipate={canParticipate}
          balance={balance}
          windows={windows}
          pending={pendingView}
          myDownvotes={(myFlags ?? []).map((f) => f.submission_id).filter((s): s is string => Boolean(s))}
          myReverted={(myReverted ?? []).map((r) => ({ id: r.id, prompt: r.prompt }))}
          latestSnapshotId={latestSnap?.id ?? null}
          history={history ?? []}
        />
      </main>
    );
  }

  /* -------------------------------- Art ----------------------------------- */
  const [{ data: applied }, { data: current }, { data: myFlags }] = await Promise.all([
    supabase
      .from("queue_submissions")
      .select("id, prompt, lane, result_asset_url, applied_at, user_id, status, profiles(display_name)")
      .eq("room_id", room.id)
      .in("status", ["applied", "reverted"])
      .order("applied_at", { ascending: false })
      .limit(12),
    room.current_submission_id
      ? supabase.from("queue_submissions").select("id, prompt, lane, user_id, applied_at, profiles(display_name)").eq("id", room.current_submission_id).maybeSingle()
      : Promise.resolve({ data: null }),
    user && room.current_submission_id
      ? supabase.from("moderation_flags").select("id").eq("submission_id", room.current_submission_id).eq("reporter_id", user.id)
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
      {header}
      <ArtRoom
        room={room}
        userId={user?.id ?? null}
        canParticipate={canParticipate}
        providers={listImageProviders()}
        balance={balance}
        windows={windows}
        current={current ? { id: current.id, prompt: current.prompt, lane: current.lane, author: displayName(current), userId: current.user_id, appliedAt: current.applied_at } : null}
        pending={pendingView}
        applied={(applied ?? []).map((a) => ({ id: a.id, prompt: a.prompt, lane: a.lane, url: a.result_asset_url, appliedAt: a.applied_at, author: displayName(a), status: a.status }))}
        alreadyDownvoted={(myFlags ?? []).length > 0}
        revertThreshold={REVERT_THRESHOLD}
        myReverted={(myReverted ?? []).map((r) => ({ id: r.id, prompt: r.prompt }))}
        history={history ?? []}
      />
    </main>
  );
}
