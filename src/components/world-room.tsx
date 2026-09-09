"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { Tables } from "@/lib/supabase/types";
import type { WorldEntity, WorldPatch, WorldState } from "@/lib/world/types";
import { replay } from "@/lib/world/patch";
import { appealAction, downvoteAction, forkAction, snapshotAction, submitPromptAction, type ActionState } from "@/app/rooms/[slug]/actions";
import { useRoomRealtime } from "./use-room-realtime";
import { HistoryList, type HistoryRow } from "./history-list";
import { WorldView, type EntityMeta } from "./world-view";

type Lane = "base" | "premium" | "instant";

export type TimelineEntry = { id: string; prompt: string; appliedAt: string | null; userId: string; author: string; summary: string; patch: WorldPatch };

function Countdown({ windowStart, seconds }: { windowStart: string; seconds: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (now === null) return <span className="tabular-nums">--:--</span>;
  const left = Math.max(0, Math.round((new Date(windowStart).getTime() + seconds * 1000 - now) / 1000));
  return (
    <span className="tabular-nums">
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

export function WorldRoom(props: {
  room: Tables<"rooms">;
  world: WorldState;
  initial: WorldState;
  timeline: TimelineEntry[];
  userId: string | null;
  canParticipate: boolean;
  balance: number | null;
  windows: { base: string; premium: string };
  pending: Array<{ id: string; lane: string; prompt: string; bid: number; mine: boolean; author: string }>;
  myDownvotes: string[];
  myReverted: Array<{ id: string; prompt: string }>;
  latestSnapshotId: string | null;
  history: HistoryRow[];
}) {
  const { room } = props;
  useRoomRealtime(room.id, ["queue_submissions", "action_history", "snapshots"], 15_000);

  const [lane, setLane] = useState<Lane>("base");
  const [selected, setSelected] = useState<WorldEntity | null>(null);
  const [scrub, setScrub] = useState<number | null>(null); // null = live
  const [submitState, submitPrompt, submitting] = useActionState<ActionState, FormData>(submitPromptAction, {});
  const [voteState, vote, voting] = useActionState<ActionState, FormData>(downvoteAction, {});
  const [appealState, doAppeal, appealing] = useActionState<ActionState, FormData>(appealAction, {});
  const [snapState, snapshot, snapping] = useActionState<ActionState, FormData>(snapshotAction, {});
  const [forkState, fork, forking] = useActionState<ActionState, FormData>(forkAction, {});

  const shownWorld = useMemo(
    () => (scrub === null ? props.world : replay(props.initial, props.timeline.map((t) => t.patch), scrub)),
    [scrub, props.world, props.initial, props.timeline],
  );
  const scrubEntry = scrub !== null && scrub > 0 ? props.timeline[scrub - 1] : null;

  const premiumPending = props.pending.filter((p) => p.lane === "premium");
  const basePending = props.pending.filter((p) => p.lane === "base");
  const topBid = premiumPending.reduce((m, p) => Math.max(m, p.bid), 0);
  const minBid = Math.max(room.premium_min_bid_credits, topBid + (topBid ? room.premium_bid_increment_credits : 0));
  const rules = (room.rules ?? {}) as { max_prompt_words?: number; world_prompt?: string };
  const cost = lane === "base" ? room.base_price_credits : lane === "instant" ? room.instant_price_credits : minBid;
  const selMeta = (selected?.meta ?? {}) as EntityMeta;
  const selEntry = selMeta.submissionId ? props.timeline.find((t) => t.id === selMeta.submissionId) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="space-y-3">
        <WorldView
          world={shownWorld}
          selectedId={selected?.id}
          onSelect={setSelected}
          highlightSubmissionId={scrubEntry?.id ?? null}
        />

        {/* Timelapse */}
        {props.timeline.length > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <span className="w-16 shrink-0 text-zinc-500">{scrub === null ? "Live" : `Step ${scrub}/${props.timeline.length}`}</span>
            <input
              type="range"
              min={0}
              max={props.timeline.length}
              value={scrub ?? props.timeline.length}
              onChange={(e) => {
                const v = Number(e.target.value);
                setScrub(v === props.timeline.length ? null : v);
                setSelected(null);
              }}
              className="flex-1"
              aria-label="Timelapse"
            />
            <span className="w-56 truncate text-zinc-500">{scrubEntry ? `${scrubEntry.author}: ${scrubEntry.summary}` : scrub === 0 ? "base world" : "now"}</span>
          </div>
        )}

        {/* Selection / provenance */}
        {selected ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <div>
              <span className="font-medium">{selected.name}</span>{" "}
              <span className="text-zinc-500">
                {selected.kind}
                {selEntry ? ` · added by ${selEntry.author} — “${selEntry.prompt}”` : ""}
              </span>
            </div>
            {props.userId && selEntry && selEntry.userId !== props.userId && scrub === null && (
              <form action={vote}>
                <input type="hidden" name="submission_id" value={selEntry.id} />
                <input type="hidden" name="slug" value={room.slug} />
                <button
                  disabled={voting || props.myDownvotes.includes(selEntry.id)}
                  className="rounded-md border border-zinc-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
                  title="Enough weighted downvotes undo this change"
                >
                  {props.myDownvotes.includes(selEntry.id) ? "Downvoted" : "👎 Downvote this change"}
                </button>
              </form>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            {rules.world_prompt ? `“${rules.world_prompt}” · ` : ""}
            {props.world.entities.length} things placed · click anything to see who added it
          </p>
        )}
        {voteState.error && <p className="text-xs text-red-600">{voteState.error}</p>}
        {voteState.message && <p className="text-xs text-emerald-600">{voteState.message}</p>}

        {props.userId && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <form action={snapshot} className="flex items-center gap-2">
              <input type="hidden" name="room_id" value={room.id} />
              <input type="hidden" name="slug" value={room.slug} />
              <button name="paid" value="0" disabled={snapping} className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">
                Snapshot
              </button>
              <button name="paid" value="1" disabled={snapping} className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">
                Buy a print (5)
              </button>
            </form>
            {props.latestSnapshotId && (
              <form action={fork} className="flex items-center gap-2">
                <input type="hidden" name="snapshot_id" value={props.latestSnapshotId} />
                <input type="hidden" name="slug" value={room.slug} />
                <button disabled={forking} className="rounded-md bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-black">
                  Fork latest snapshot → private world
                </button>
              </form>
            )}
            {snapState.error && <span className="text-red-600">{snapState.error}</span>}
            {snapState.message && (
              <span className="text-emerald-600">
                {snapState.message.split(": ")[0]}:{" "}
                <a className="underline" href={snapState.message.split(": ")[1]}>
                  open
                </a>
              </span>
            )}
            {forkState.error && <span className="text-red-600">{forkState.error}</span>}
          </div>
        )}
      </section>

      <aside className="space-y-5">
        {props.canParticipate ? (
          <form action={submitPrompt} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <input type="hidden" name="room_id" value={room.id} />
            <input type="hidden" name="slug" value={room.slug} />
            <input type="hidden" name="provider" value="mock" />
            <input type="hidden" name="lane" value={lane} />
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Change the world</span>
              <span className="text-xs text-zinc-500">{props.balance ?? 0} credits</span>
            </div>
            <input
              name="prompt"
              required
              maxLength={200}
              placeholder={`e.g. "park a red taxi outside the bank" (≤${rules.max_prompt_words ?? 12} words)`}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
            <div className="grid grid-cols-3 gap-1 text-xs">
              {(["base", "premium", "instant"] as Lane[]).map((l) => (
                <label key={l} className={`cursor-pointer rounded-md border px-2 py-1.5 text-center ${lane === l ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black" : "border-zinc-300 dark:border-zinc-700"}`}>
                  <input type="radio" value={l} checked={lane === l} onChange={() => setLane(l)} className="sr-only" aria-label={l} />
                  {l === "base" ? `Base · ${room.base_price_credits}` : l === "premium" ? `Bid · ${minBid}+` : `Instant · ${room.instant_price_credits}`}
                </label>
              ))}
            </div>
            {lane === "premium" && (
              <label className="block text-xs">
                <span className="text-zinc-500">Your bid (min {minBid})</span>
                <input name="bid" type="number" min={minBid} step={room.premium_bid_increment_credits} defaultValue={minBid} className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 dark:border-zinc-700" />
              </label>
            )}
            <p className="text-xs text-zinc-500">
              Add, move, recolour or remove things: “three pine trees top left”, “move the taxi next to the cafe”, “paint the bank gold”, “demolish the warehouse”.
            </p>
            <button disabled={submitting} className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black">
              {submitting ? "Submitting…" : `Submit for ${cost} credit${cost === 1 ? "" : "s"}`}
            </button>
            {submitState.error && <p className="text-xs text-red-600">{submitState.error}</p>}
            {submitState.message && <p className="text-xs text-emerald-600">{submitState.message}</p>}
          </form>
        ) : (
          <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
            {props.userId ? (
              "You are not a member of this world."
            ) : (
              <>
                <a className="underline" href={`/login?next=/rooms/${room.slug}`}>
                  Sign in
                </a>{" "}
                to add things to this world.
              </>
            )}
          </div>
        )}

        <div className="space-y-3 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="font-medium">Premium lane</span>
            <span className="text-xs text-zinc-500">
              resolves in <Countdown windowStart={props.windows.premium} seconds={room.premium_window_seconds} />
            </span>
          </div>
          {premiumPending.length === 0 ? (
            <p className="text-xs text-zinc-500">No bids this window.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {[...premiumPending].sort((a, b) => b.bid - a.bid).map((p) => (
                <li key={p.id} className="flex justify-between">
                  <span>
                    {p.mine ? "You" : p.author}: “{p.prompt}”
                  </span>
                  <span className="font-medium">{p.bid}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <span className="font-medium">Base lane</span>
            <span className="text-xs text-zinc-500">
              resolves in <Countdown windowStart={props.windows.base} seconds={room.base_window_seconds} />
            </span>
          </div>
          {basePending.length === 0 ? (
            <p className="text-xs text-zinc-500">No entries this window.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {basePending.map((p) => (
                <li key={p.id}>
                  {p.mine ? "You" : p.author}: “{p.prompt}”
                </li>
              ))}
            </ul>
          )}
        </div>

        {props.myReverted.length > 0 && (
          <div className="space-y-2 rounded-xl border border-red-300 p-4 text-sm dark:border-red-800">
            <span className="font-medium">Your reverted changes</span>
            {props.myReverted.map((r) => (
              <form key={r.id} action={doAppeal} className="flex items-center justify-between gap-2 text-xs">
                <input type="hidden" name="submission_id" value={r.id} />
                <input type="hidden" name="slug" value={room.slug} />
                <span>“{r.prompt}”</span>
                <button disabled={appealing} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700">
                  Appeal
                </button>
              </form>
            ))}
            {appealState.error && <p className="text-xs text-red-600">{appealState.error}</p>}
            {appealState.message && <p className="text-xs text-emerald-600">{appealState.message}</p>}
          </div>
        )}

        <HistoryList rows={props.history} />
      </aside>
    </div>
  );
}
