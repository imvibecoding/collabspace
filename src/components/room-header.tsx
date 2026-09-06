"use client";

import { useActionState } from "react";
import type { Tables } from "@/lib/supabase/types";
import { inviteAction, modeSuggestionAction, setModeAction, type ActionState } from "@/app/rooms/[slug]/actions";

export function RoomHeader({
  room,
  isOwner,
  participants,
  pendingSuggestion,
}: {
  room: Tables<"rooms">;
  isOwner: boolean;
  participants: Array<{ userId: string; role: string; name: string }>;
  pendingSuggestion: Tables<"room_mode_changes"> | null;
}) {
  const [inviteState, invite, inviting] = useActionState<ActionState, FormData>(inviteAction, {});

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{room.name}</h1>
          <p className="text-xs text-zinc-500">
            {room.type} · {room.visibility} · mode: <span className="font-medium">{room.mode}</span> · {participants.length} member
            {participants.length === 1 ? "" : "s"}
          </p>
        </div>
        {isOwner && room.visibility === "private" && (
          <form action={setModeAction} className="flex items-center gap-2 text-xs">
            <input type="hidden" name="room_id" value={room.id} />
            <input type="hidden" name="slug" value={room.slug} />
            <label className="text-zinc-500">Mode</label>
            <select name="mode" defaultValue={room.mode} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
              <option value="freeform">freeform</option>
              <option value="queue">turn / queue</option>
              <option value="sectioned">sectioned (locks)</option>
            </select>
            <button className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700">Set</button>
          </form>
        )}
      </div>

      {pendingSuggestion && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <div>
            <span className="font-medium">Suggestion:</span> switch this room from <b>{pendingSuggestion.from_mode}</b> to{" "}
            <b>{pendingSuggestion.to_mode}</b> mode.
            {pendingSuggestion.reason && <span className="text-zinc-600 dark:text-zinc-300"> {pendingSuggestion.reason}</span>}
          </div>
          {isOwner ? (
            <form action={modeSuggestionAction} className="flex gap-2">
              <input type="hidden" name="suggestion_id" value={pendingSuggestion.id} />
              <input type="hidden" name="slug" value={room.slug} />
              <button name="accept" value="1" className="rounded bg-amber-600 px-3 py-1 text-white">
                Accept
              </button>
              <button name="accept" value="0" className="rounded border border-amber-600 px-3 py-1">
                Keep {pendingSuggestion.from_mode}
              </button>
            </form>
          ) : (
            <span className="text-xs text-zinc-500">Waiting for the owner to decide.</span>
          )}
        </div>
      )}

      {room.visibility === "private" && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          <span>
            Members:{" "}
            {participants.map((p) => (
              <span key={p.userId} className="mr-2 rounded bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
                {p.name}
                {p.role === "owner" ? " (owner)" : ""}
              </span>
            ))}
          </span>
          {isOwner && (
            <form action={invite} className="flex items-center gap-2">
              <input type="hidden" name="room_id" value={room.id} />
              <input type="hidden" name="slug" value={room.slug} />
              <input name="email" type="email" required placeholder="invite by email" className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
              <button disabled={inviting} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700">
                Invite
              </button>
              {inviteState.error && <span className="text-red-600">{inviteState.error}</span>}
              {inviteState.message && <span className="text-emerald-600">{inviteState.message}</span>}
            </form>
          )}
        </div>
      )}
    </header>
  );
}
