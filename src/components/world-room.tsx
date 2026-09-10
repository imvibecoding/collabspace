"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import type { Tables } from "@/lib/supabase/types";
import type { WorldEntity, WorldPatch, WorldState } from "@/lib/world/types";
import { replay } from "@/lib/world/patch";
import { appealAction, downvoteAction, snapshotAction, submitPromptAction, type ActionState } from "@/app/rooms/[slug]/actions";
import { useRoomRealtime } from "./use-room-realtime";
import { HistoryList, type HistoryRow } from "./history-list";
import type { EntityMeta, ViewMode } from "./world-3d";
import { World3DClient } from "./world-3d-client";
import { ZONE_THEME_COST_CREDITS } from "@/lib/world/pricing";

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
  history: HistoryRow[];
}) {
  const { room } = props;
  useRoomRealtime(room.id, ["queue_submissions", "action_history", "snapshots"], 15_000);

  const [lane, setLane] = useState<Lane>("base");
  const [selected, setSelected] = useState<WorldEntity | null>(null);
  const [scrub, setScrub] = useState<number | null>(null); // null = live
  const [hour, setHour] = useState<number | null>(null); // null = live Melbourne clock
  const [rain, setRain] = useState(false);
  const [view, setView] = useState<ViewMode>("iso");
  const [focusZoneId, setFocusZoneId] = useState<{ id: string; key: number } | null>(null);
  const [submitState, submitPrompt, submitting] = useActionState<ActionState, FormData>(submitPromptAction, {});
  const [voteState, vote, voting] = useActionState<ActionState, FormData>(downvoteAction, {});
  const [appealState, doAppeal, appealing] = useActionState<ActionState, FormData>(appealAction, {});
  const [snapState, snapshot, snapping] = useActionState<ActionState, FormData>(snapshotAction, {});

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
  const freeform = room.visibility === "private" && room.mode === "freeform";
  const cost = freeform || lane === "base" ? room.base_price_credits : lane === "instant" ? room.instant_price_credits : minBid;
  const selMeta = (selected?.meta ?? {}) as EntityMeta;
  const selEntry = selMeta.submissionId ? props.timeline.find((t) => t.id === selMeta.submissionId) : undefined;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
      <section className="space-y-3">
        <World3DClient
          world={shownWorld}
          selectedId={selected?.id}
          onSelect={setSelected}
          highlightSubmissionId={scrubEntry?.id ?? null}
          hourOverride={hour}
          rain={rain}
          view={view}
          focusZoneId={focusZoneId}
          height="min(74vh, 820px)"
        />

        {/* Areas — click to fly there */}
        {(shownWorld.zones ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500">Areas</span>
            {(shownWorld.zones ?? []).map((z) => (
              <button
                key={z.id}
                type="button"
                title={z.subtitle}
                onClick={() => setFocusZoneId({ id: z.id, key: Date.now() })}
                className={`rounded-full border px-2.5 py-1 transition-colors ${
                  focusZoneId?.id === z.id
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
                    : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                }`}
              >
                {z.name}
              </button>
            ))}
            {focusZoneId && (
              <button type="button" onClick={() => setFocusZoneId(null)} className="text-zinc-500 underline">
                whole city
              </button>
            )}
          </div>
        )}

        {/* Scene controls */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">View</span>
            <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
              {(["iso", "top"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-2.5 py-1 ${view === v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                >
                  {v === "iso" ? "3D city" : "Bird's-eye"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Time</span>
            <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setHour(null)}
                className={`px-2.5 py-1 ${hour === null ? "bg-emerald-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              >
                Live in Melbourne
              </button>
              <button
                type="button"
                onClick={() => setHour((h) => (h === null ? 20 : h))}
                className={`px-2.5 py-1 ${hour !== null ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              >
                Preview a time
              </button>
            </div>
            {hour !== null && (
              <>
                <input
                  type="range"
                  min={0}
                  max={23.75}
                  step={0.25}
                  value={hour}
                  onChange={(e) => setHour(Number(e.target.value))}
                  className="w-36"
                  aria-label="Time of day"
                />
                <span className="w-12 tabular-nums text-zinc-600 dark:text-zinc-300">
                  {String(Math.floor(hour)).padStart(2, "0")}:{String(Math.round((hour % 1) * 60)).padStart(2, "0")}
                </span>
              </>
            )}
          </div>

          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={rain} onChange={(e) => setRain(e.target.checked)} /> Rain
          </label>
        </div>

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
            {snapState.error && <span className="text-red-600">{snapState.error}</span>}
            {snapState.message && (
              <span className="text-emerald-600">
                {snapState.message.split(": ")[0]}:{" "}
                <Link className="underline" href={snapState.message.split(": ")[1]}>
                  open
                </Link>
              </span>
            )}
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
            {freeform && <p className="text-xs text-zinc-500">Freeform room: prompts apply immediately for {room.base_price_credits} credit.</p>}
            <div className={`grid grid-cols-3 gap-1 text-xs${freeform ? " hidden" : ""}`}>
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
              Add, move, recolour or remove things: “park a police car in Footscray”, “three pine trees in
              Fitzroy”, “move the taxi next to the cafe”, “demolish the warehouse”. Restyling a whole area —
              “make the west look like an industrial port” — costs {ZONE_THEME_COST_CREDITS} credits.
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
                <Link className="underline" href={`/login?next=/rooms/${room.slug}`}>
                  Sign in
                </Link>{" "}
                to add things to this world.
              </>
            )}
          </div>
        )}

        {!freeform && <div className="space-y-3 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
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
        </div>}

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
