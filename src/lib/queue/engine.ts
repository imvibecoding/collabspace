/**
 * Queue Engine — pure, provider-agnostic resolution logic.
 *
 * A room has two lanes. Every `windowSeconds` the pending submissions for that
 * window are resolved:
 *   - premium lane: highest bid wins (ties → earliest submission)
 *   - base lane:    one winner picked at random, weighted down by the
 *                   submitter's reputation priority penalty
 * When both lanes resolve in the same window, premium applies first, then base.
 * "instant" lane bypasses the queue entirely and is applied on submit.
 *
 * Nothing in here touches the database; the service layer feeds it rows and
 * writes back the outcome. That keeps it unit-testable and reusable for any
 * room type (art wall today, music/3D later).
 */

export type Lane = "base" | "premium" | "instant";

export interface QueueRoomConfig {
  baseWindowSeconds: number;
  premiumWindowSeconds: number;
  basePriceCredits: number;
  premiumMinBidCredits: number;
  premiumBidIncrementCredits: number;
  instantPriceCredits: number;
}

export interface PendingSubmission {
  id: string;
  userId: string;
  lane: Lane;
  bidCredits: number;
  createdAt: Date;
  /** From reputation_scores.priority_penalty; 0 = no penalty. */
  priorityPenalty?: number;
}

export interface WindowResolution {
  /** Ordered: premium winner first (if any), then base winner (if any). */
  applied: PendingSubmission[];
  /** Everything that lost this window and should be refunded. */
  refunded: PendingSubmission[];
}

/** Floor a timestamp to the start of its resolution window. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export function nextWindowStart(now: Date, windowSeconds: number): Date {
  return new Date(windowStart(now, windowSeconds).getTime() + windowSeconds * 1000);
}

/** Selection weight for the base-lane lottery. Penalised users still can win, just less often. */
export function baseLaneWeight(priorityPenalty = 0): number {
  return 1 / (1 + Math.max(0, priorityPenalty));
}

/** Credits a submission costs (or holds) at submit time. */
export function submissionCost(config: QueueRoomConfig, lane: Lane, bidCredits = 0): number {
  switch (lane) {
    case "base":
      return config.basePriceCredits;
    case "premium":
      return bidCredits;
    case "instant":
      return config.instantPriceCredits;
  }
}

export type BidValidation = { ok: true } | { ok: false; reason: string; minimumBid: number };

/**
 * Premium bids must meet the room minimum and beat the current highest bid in
 * the window by at least one increment.
 */
export function validateBid(
  config: QueueRoomConfig,
  bidCredits: number,
  currentHighestBid: number | null,
): BidValidation {
  const minimumBid =
    currentHighestBid === null
      ? config.premiumMinBidCredits
      : Math.max(config.premiumMinBidCredits, currentHighestBid + config.premiumBidIncrementCredits);
  if (!Number.isInteger(bidCredits) || bidCredits < minimumBid) {
    return { ok: false, reason: `Bid must be at least ${minimumBid} credits`, minimumBid };
  }
  return { ok: true };
}

/** Pick the premium winner: highest bid, ties broken by earliest submission. */
export function pickPremiumWinner(premium: PendingSubmission[]): PendingSubmission | null {
  if (premium.length === 0) return null;
  return premium.reduce((best, s) => {
    if (s.bidCredits > best.bidCredits) return s;
    if (s.bidCredits === best.bidCredits && s.createdAt < best.createdAt) return s;
    return best;
  });
}

/** Weighted random pick for the base lane. `rng` must return [0, 1). */
export function pickBaseWinner(
  base: PendingSubmission[],
  rng: () => number = Math.random,
): PendingSubmission | null {
  if (base.length === 0) return null;
  const weights = base.map((s) => baseLaneWeight(s.priorityPenalty));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < base.length; i++) {
    r -= weights[i];
    if (r < 0) return base[i];
  }
  return base[base.length - 1];
}

/**
 * Resolve one window. Input is every *pending* submission whose window_start
 * matches the window being resolved. Instant-lane submissions never reach here.
 */
export function resolveWindow(
  pending: PendingSubmission[],
  rng: () => number = Math.random,
): WindowResolution {
  const premium = pending.filter((s) => s.lane === "premium");
  const base = pending.filter((s) => s.lane === "base");

  const premiumWinner = pickPremiumWinner(premium);
  const baseWinner = pickBaseWinner(base, rng);

  const applied = [premiumWinner, baseWinner].filter((s): s is PendingSubmission => s !== null);
  const appliedIds = new Set(applied.map((s) => s.id));
  const refunded = pending.filter((s) => !appliedIds.has(s.id));

  return { applied, refunded };
}
