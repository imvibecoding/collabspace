/**
 * Credit rules — pure pricing/eligibility logic shared by server and UI.
 *
 * One universal credit currency, consumed per feature type. Free-tier grants are
 * spendable in public rooms only; private collabs always bill pay-per-use at real
 * provider cost plus a transparent margin.
 */

export type CreditKind =
  | "text"
  | "image"
  | "music"
  | "video"
  | "threed"
  | "priority"
  | "hosting"
  | "universal";

export type Tier = "free" | "premium" | "enterprise";

export interface Balance {
  /** Credits that came from free-tier grants (public rooms only). */
  free: number;
  /** Purchased / earned credits (valid anywhere). */
  paid: number;
}

/** Monthly free allotments per kind, tuned so a free user can finish one shareable thing. */
export const FREE_MONTHLY_GRANT: Partial<Record<CreditKind, number>> = {
  image: 15,
  text: 50,
  priority: 2,
};

/** Transparent margin applied over actual provider cost. */
export const MARGIN_PERCENT = 30;

/** 1 credit ≈ this many cents of provider cost before margin. */
export const CENTS_PER_CREDIT = 2;

/** Convert a provider's real cost into credits, applying the platform margin. */
export function creditsForProviderCost(providerCostCents: number): number {
  const withMargin = providerCostCents * (1 + MARGIN_PERCENT / 100);
  return Math.max(1, Math.ceil(withMargin / CENTS_PER_CREDIT));
}

export interface SpendContext {
  roomVisibility: "public" | "private";
  balance: Balance;
  amount: number;
}

export type SpendPlan =
  | { ok: true; fromFree: number; fromPaid: number }
  | { ok: false; reason: "insufficient_credits"; shortfall: number };

/**
 * Decide how a spend is funded. Public rooms drain free credits first, then paid.
 * Private rooms may only use paid credits (closes the multi-account free-credit loophole).
 */
export function planSpend({ roomVisibility, balance, amount }: SpendContext): SpendPlan {
  if (amount <= 0) return { ok: true, fromFree: 0, fromPaid: 0 };
  const freeUsable = roomVisibility === "public" ? balance.free : 0;
  const fromFree = Math.min(freeUsable, amount);
  const remaining = amount - fromFree;
  if (remaining > balance.paid) {
    return { ok: false, reason: "insufficient_credits", shortfall: remaining - balance.paid };
  }
  return { ok: true, fromFree, fromPaid: remaining };
}

/** Video generation is premium+; everything else is available on free. */
export function kindAllowedForTier(kind: CreditKind, tier: Tier): boolean {
  if (kind === "video") return tier !== "free";
  return true;
}

/** Card on file is mandatory to create or join a private collab. */
export function canJoinPrivateRoom(profile: { card_on_file: boolean; phone_verified: boolean }): boolean {
  return profile.card_on_file && profile.phone_verified;
}
