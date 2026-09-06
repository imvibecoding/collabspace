import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Enums } from "@/lib/supabase/types";
import { FREE_MONTHLY_GRANT, type Balance, type CreditKind } from "./rules";

export class InsufficientCreditsError extends Error {
  constructor(public readonly shortfall: number) {
    super("insufficient_credits");
  }
}

export const ALL_KINDS: CreditKind[] = ["text", "image", "music", "video", "threed", "priority", "hosting", "universal"];

export async function getBalances(userId: string): Promise<Record<CreditKind, Balance>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("credit_ledger")
    .select("kind, delta, free_tier")
    .eq("user_id", userId);
  if (error) throw error;
  const out = Object.fromEntries(ALL_KINDS.map((k) => [k, { free: 0, paid: 0 }])) as Record<CreditKind, Balance>;
  for (const row of data ?? []) {
    const b = out[row.kind as CreditKind];
    if (row.free_tier) b.free += row.delta;
    else b.paid += row.delta;
  }
  return out;
}

/** Grant this month's free allotment once per kind. Safe to call on every page load. */
export async function ensureMonthlyGrant(userId: string): Promise<void> {
  const admin = createAdminClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data, error } = await admin
    .from("credit_ledger")
    .select("kind")
    .eq("user_id", userId)
    .eq("reason", "monthly_grant")
    .gte("created_at", monthStart.toISOString());
  if (error) throw error;
  const granted = new Set((data ?? []).map((r) => r.kind));
  for (const [kind, amount] of Object.entries(FREE_MONTHLY_GRANT)) {
    if (!amount || granted.has(kind as Enums<"credit_kind">)) continue;
    const { error: e } = await admin.rpc("grant_credits", {
      p_user_id: userId,
      p_kind: kind as Enums<"credit_kind">,
      p_amount: amount,
      p_reason: "monthly_grant",
      p_free_tier: true,
    });
    if (e) throw e;
  }
}

export async function grant(input: {
  userId: string;
  kind: CreditKind;
  amount: number;
  reason: string;
  freeTier?: boolean;
  stripeRef?: string;
}): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("grant_credits", {
    p_user_id: input.userId,
    p_kind: input.kind,
    p_amount: input.amount,
    p_reason: input.reason,
    p_free_tier: input.freeTier ?? false,
    p_stripe_ref: input.stripeRef,
  });
  if (error) throw error;
  return data;
}

/** Atomic spend via the DB function. Throws InsufficientCreditsError when short. */
export async function spend(input: {
  userId: string;
  kind: CreditKind;
  amount: number;
  reason: string;
  roomId?: string;
  submissionId?: string;
  providerCostCents?: number;
}): Promise<number[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("spend_credits", {
    p_user_id: input.userId,
    p_kind: input.kind,
    p_amount: input.amount,
    p_reason: input.reason,
    p_room_id: input.roomId,
    p_submission_id: input.submissionId,
    p_provider_cost_cents: input.providerCostCents,
  });
  if (error) {
    if (error.message.includes("insufficient_credits")) {
      const m = /shortfall=(\d+)/.exec(error.details ?? "");
      throw new InsufficientCreditsError(m ? Number(m[1]) : input.amount);
    }
    throw error;
  }
  return data ?? [];
}

export async function refundSubmission(submissionId: string, reason = "queue_refund"): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("refund_submission", { p_submission_id: submissionId, p_reason: reason });
  if (error) throw error;
  return data ?? 0;
}
