"use client";

import { useActionState, useEffect, useState } from "react";
import type { Tables } from "@/lib/supabase/types";
import { appealAction, downvoteAction, snapshotAction, submitPromptAction, type ActionState } from "@/app/rooms/[slug]/actions";
import { useRoomRealtime } from "./use-room-realtime";
import { HistoryList, type HistoryRow } from "./history-list";

type Lane = "base" | "premium" | "instant";

function Countdown({ windowStart, seconds }: { windowStart: string; seconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const end = new Date(windowStart).getTime() + seconds * 1000;
  const left = Math.max(0, Math.round((end - now) / 1000));
  return (
    <span className="tabular-nums">
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

export function ArtRoom(props: {
  room: Tables<"rooms">;
  userId: string | null;
  canParticipate: boolean;
  providers: Array<{ key: string; label: string }>;
  balance: number | null;
  windows: { base: string; premium: string };
  current: { id: string; prompt: string; lane: string; author: string; userId: string; appliedAt: string | null } | null;
  pending: Array<{ id: string; lane: string; prompt: string; bid: number; mine: boolean; author: string; windowStart: string }>;
  applied: Array<{ id: string; prompt: string; lane: string; url: string | null; appliedAt: string | null; author: string; status: string }>;
  alreadyDownvoted: boolean;
  revertThreshold: number;
  myReverted: Array<{ id: string; prompt: string }>;
  history: HistoryRow[];
}) {
  const { room } = props;
  useRoomRealtime(room.id, ["queue_submissions", "action_history"], 15_000);

  const [lane, setLane] = useState<Lane>("base");
  const [submitState, submitPrompt, submitting] = useActionState<ActionState, FormData>(submitPromptAction, {});
  const [voteState, vote, voting] = useActionState<ActionState, FormData>(downvoteAction, {});
  const [appealState, doAppeal, appealing] = useActionState<ActionState, FormData>(appealAction, {});
  const [snapState, snapshot, snapping] = useActionState<ActionState, FormData>(snapshotAction, {});

  const premiumPending = props.pending.filter((p) => p.lane === "premium");
  const basePending = props.pending.filter((p) => p.lane === "base");
  const topBid = premiumPending.reduce((m, p) => Math.max(m, p.bid), 0);
  const minBid = Math.max(room.premium_min_bid_credits, topBid + (topBid ? room.premium_bid_increment_credits : 0));
  const rules = (room.rules ?? {}) as { max_prompt_words?: number };
  const cost = lane === "base" ? room.base_price_credits : lane === "instant" ? room.instant_price_credits : minBid;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="space-y-3">
        <div className="relative aspect-square overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
          {room.current_asset_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={room.current_asset_url} alt={props.current?.prompt ?? "canvas"} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-400">The canvas is empty. Be the first.</div>
          )}
        </div>
        {props.current && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <span className="font-medium">“{props.current.prompt}”</span>{" "}
              <span className="text-zinc-500">
                by {props.current.author} · {props.current.lane} lane
              </span>
            </div>
            {props.userId && props.userId !== props.current.userId && (
              <form action={vote}>
                <input type="hidden" name="submission_id" value={props.current.id} />
                <input type="hidden" name="slug" value={room.slug} />
                <button
                  disabled={voting || props.alreadyDownvoted}
                  className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  title={`${props.revertThreshold} weighted downvotes revert this change`}
                >
                  {props.alreadyDownvoted ? "Downvoted" : "👎 Downvote"}
                </button>
              </form>
            )}
          </div>
        )}
        {voteState.error && <p className="text-xs text-red-600">{voteState.error}</p>}
        {voteState.message && <p className="text-xs text-emerald-600">{voteState.message}</p>}

        {props.userId && room.current_asset_url && (
          <form action={snapshot} className="flex flex-wrap items-center gap-2 text-xs">
            <input type="hidden" name="room_id" value={room.id} />
            <input type="hidden" name="slug" value={room.slug} />
            <button name="paid" value="1" disabled={snapping} className="rounded-md bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-black">
              Buy a print (5 credits)
            </button>
            <button name="paid" value="0" disabled={snapping} className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">
              Free snapshot
            </button>
            {snapState.error && <span className="text-red-600">{snapState.error}</span>}
            {snapState.message && (
              <span className="text-emerald-600">
                {snapState.message.split(": ")[0]}:{" "}
                <a className="underline" href={snapState.message.split(": ")[1]}>
                  open
                </a>
              </span>
            )}
          </form>
        )}

        {props.applied.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Recent changes</h3>
            <div className="grid grid-cols-6 gap-2">
              {props.applied.map((a) => (
                <div key={a.id} className={`overflow-hidden rounded border ${a.status === "reverted" ? "border-red-400 opacity-50" : "border-zinc-200 dark:border-zinc-800"}`} title={`${a.prompt} — ${a.author}${a.status === "reverted" ? " (reverted)" : ""}`}>
                  {a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.prompt} className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="aspect-square" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <aside className="space-y-5">
        {props.canParticipate ? (
          <form action={submitPrompt} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <input type="hidden" name="room_id" value={room.id} />
            <input type="hidden" name="slug" value={room.slug} />
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Submit a prompt</span>
              <span className="text-xs text-zinc-500">{props.balance ?? 0} image credits</span>
            </div>
            <input
              name="prompt"
              required
              maxLength={200}
              placeholder={rules.max_prompt_words ? `up to ${rules.max_prompt_words} words` : "your prompt"}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
            <div className="grid grid-cols-3 gap-1 text-xs">
              {(["base", "premium", "instant"] as Lane[]).map((l) => (
                <label key={l} className={`cursor-pointer rounded-md border px-2 py-1.5 text-center ${lane === l ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black" : "border-zinc-300 dark:border-zinc-700"}`}>
                  <input type="radio" name="lane" value={l} checked={lane === l} onChange={() => setLane(l)} className="sr-only" />
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
            <label className="block text-xs">
              <span className="text-zinc-500">Image model</span>
              <select name="provider" className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 dark:border-zinc-700">
                {props.providers.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-zinc-500">
              {lane === "base" && "Flat price. One random winner per window."}
              {lane === "premium" && "Highest bid in the window wins and applies before the base pick. Losing bids are refunded."}
              {lane === "instant" && "Skips the queue and applies right now."}
            </p>
            <button disabled={submitting} className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black">
              {submitting ? "Submitting…" : `Submit for ${cost} credit${cost === 1 ? "" : "s"}`}
            </button>
            {submitState.error && <p className="text-xs text-red-600">{submitState.error}</p>}
            {submitState.message && <p className="text-xs text-emerald-600">{submitState.message}</p>}
          </form>
        ) : (
          <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
            {props.userId ? "You are not a member of this room." : (
              <>
                <a className="underline" href={`/login?next=/rooms/${room.slug}`}>Sign in</a> to submit prompts and vote.
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
