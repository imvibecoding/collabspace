"use client";

import { useActionState, useState } from "react";
import type { Tables } from "@/lib/supabase/types";
import { addCardAction, deleteCardAction, moveCardAction, toggleLockAction, updateCardAction, type ActionState } from "@/app/rooms/[slug]/actions";
import { useRoomRealtime } from "./use-room-realtime";
import { HistoryList, type HistoryRow } from "./history-list";

type Card = Tables<"kanban_cards"> & { locked_by_name: string | null };

function CardView({ card, room, userId, columns }: { card: Card; room: Tables<"rooms">; userId: string; columns: Tables<"kanban_columns">[] }) {
  const [editing, setEditing] = useState(false);
  const [state, update, saving] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const r = await updateCardAction(prev, fd);
    if (r.ok) setEditing(false);
    return r;
  }, {});
  const lockedByMe = card.locked_by === userId;
  const lockedByOther = Boolean(card.locked_by) && !lockedByMe;

  return (
    <li className={`rounded-md border p-3 text-sm ${lockedByOther ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20" : lockedByMe ? "border-emerald-500" : "border-zinc-200 dark:border-zinc-800"}`}>
      {editing && lockedByMe ? (
        <form action={update} className="space-y-2">
          <input type="hidden" name="card_id" value={card.id} />
          <input type="hidden" name="room_id" value={room.id} />
          <input type="hidden" name="slug" value={room.slug} />
          <input name="title" defaultValue={card.title} required className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          <textarea name="body" defaultValue={card.body ?? ""} rows={3} className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700" />
          <div className="flex gap-2 text-xs">
            <button disabled={saving} className="rounded bg-zinc-900 px-2 py-1 text-white dark:bg-zinc-100 dark:text-black">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700">Cancel</button>
            {state.error && <span className="text-red-600">{state.error}</span>}
          </div>
        </form>
      ) : (
        <>
          <div className="font-medium">{card.title}</div>
          {card.body && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">{card.body}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
            {lockedByOther ? (
              <span className="text-amber-700 dark:text-amber-400">🔒 {card.locked_by_name ?? "someone"} is editing</span>
            ) : (
              <>
                <form action={toggleLockAction}>
                  <input type="hidden" name="card_id" value={card.id} />
                  <input type="hidden" name="room_id" value={room.id} />
                  <input type="hidden" name="slug" value={room.slug} />
                  <input type="hidden" name="lock" value={lockedByMe ? "0" : "1"} />
                  <button className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700">{lockedByMe ? "Unlock" : "Lock & edit"}</button>
                </form>
                {lockedByMe && (
                  <button onClick={() => setEditing(true)} className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700">
                    Edit
                  </button>
                )}
                <form action={moveCardAction} className="inline">
                  <input type="hidden" name="card_id" value={card.id} />
                  <input type="hidden" name="room_id" value={room.id} />
                  <input type="hidden" name="slug" value={room.slug} />
                  <select
                    name="column_id"
                    defaultValue={card.column_id}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
                    aria-label="Move to column"
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        → {c.title}
                      </option>
                    ))}
                  </select>
                </form>
                <form action={deleteCardAction} className="inline">
                  <input type="hidden" name="card_id" value={card.id} />
                  <input type="hidden" name="room_id" value={room.id} />
                  <input type="hidden" name="slug" value={room.slug} />
                  <button className="rounded border border-zinc-300 px-2 py-0.5 text-red-600 dark:border-zinc-700">Delete</button>
                </form>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function AddCard({ room, columnId }: { room: Tables<"rooms">; columnId: string }) {
  const [state, add, adding] = useActionState<ActionState, FormData>(addCardAction, {});
  return (
    <form action={add} className="mt-2 flex gap-1">
      <input type="hidden" name="room_id" value={room.id} />
      <input type="hidden" name="column_id" value={columnId} />
      <input type="hidden" name="slug" value={room.slug} />
      <input name="title" required placeholder="New card" className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700" />
      <button disabled={adding} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
        Add
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function KanbanRoom(props: {
  room: Tables<"rooms">;
  userId: string;
  columns: Tables<"kanban_columns">[];
  cards: Card[];
  history: HistoryRow[];
}) {
  useRoomRealtime(props.room.id, ["kanban_cards", "kanban_columns", "room_participants", "room_mode_changes", "action_history"]);
  const someoneElseEditing = props.room.mode === "queue" && props.cards.some((c) => c.locked_by && c.locked_by !== props.userId);

  return (
    <div className="space-y-6">
      {props.room.mode === "queue" && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Turn-based mode: one person edits at a time. {someoneElseEditing ? "Someone currently holds the turn." : "The turn is free — lock a card to take it."}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {props.columns.map((col) => (
          <section key={col.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="mb-2 text-sm font-semibold">{col.title}</h3>
            <ul className="space-y-2">
              {props.cards
                .filter((c) => c.column_id === col.id)
                .map((c) => (
                  <CardView key={c.id} card={c} room={props.room} userId={props.userId} columns={props.columns} />
                ))}
            </ul>
            <AddCard room={props.room} columnId={col.id} />
          </section>
        ))}
      </div>
      <HistoryList rows={props.history} />
    </div>
  );
}
