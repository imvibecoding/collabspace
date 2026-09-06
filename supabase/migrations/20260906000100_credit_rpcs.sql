-- Credit ledger RPCs. All mutations of credit_ledger go through these
-- security-definer functions so balance checks and inserts are atomic.
-- They are executable by the service role only (revoked from anon/authenticated),
-- except `my_credit_balances` which is a read helper for the signed-in user.

-- Balance split into free-tier vs paid credits for a kind.
create or replace function credit_balances(p_user_id uuid, p_kind credit_kind)
returns table (free integer, paid integer)
language sql security definer stable set search_path = public as $$
  select
    coalesce(sum(delta) filter (where free_tier), 0)::integer as free,
    coalesce(sum(delta) filter (where not free_tier), 0)::integer as paid
  from credit_ledger
  where user_id = p_user_id and kind = p_kind;
$$;

-- Signed-in user's balances across all kinds (used by the UI).
create or replace function my_credit_balances()
returns table (kind credit_kind, free integer, paid integer)
language sql security definer stable set search_path = public as $$
  select
    kind,
    coalesce(sum(delta) filter (where free_tier), 0)::integer as free,
    coalesce(sum(delta) filter (where not free_tier), 0)::integer as paid
  from credit_ledger
  where user_id = auth.uid()
  group by kind;
$$;

-- Grant credits (monthly allotment, purchase, admin adjustment).
create or replace function grant_credits(
  p_user_id uuid,
  p_kind credit_kind,
  p_amount integer,
  p_reason text,
  p_free_tier boolean default false,
  p_stripe_ref text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_amount <= 0 then raise exception 'grant amount must be positive'; end if;
  insert into credit_ledger (user_id, kind, delta, reason, free_tier, stripe_ref)
  values (p_user_id, p_kind, p_amount, p_reason, p_free_tier, p_stripe_ref)
  returning id into v_id;
  return v_id;
end $$;

-- Spend credits atomically. Free-tier credits are only usable in public rooms
-- (or when no room is given, e.g. account-level purchases of priority).
-- Returns the ledger row ids written. Raises 'insufficient_credits' on failure.
create or replace function spend_credits(
  p_user_id uuid,
  p_kind credit_kind,
  p_amount integer,
  p_reason text,
  p_room_id uuid default null,
  p_submission_id uuid default null,
  p_provider_cost_cents integer default null
) returns bigint[]
language plpgsql security definer set search_path = public as $$
declare
  v_free integer;
  v_paid integer;
  v_from_free integer := 0;
  v_from_paid integer := 0;
  v_public boolean := false;
  v_ids bigint[] := '{}';
  v_id bigint;
begin
  if p_amount < 0 then raise exception 'spend amount must be >= 0'; end if;
  if p_amount = 0 then return v_ids; end if;

  -- serialise spends per user to avoid double-spend races
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if p_room_id is not null then
    select visibility = 'public' into v_public from rooms where id = p_room_id;
    if v_public is null then raise exception 'room not found'; end if;
  end if;

  select free, paid into v_free, v_paid from credit_balances(p_user_id, p_kind);

  if v_public then v_from_free := least(v_free, p_amount); end if;
  v_from_paid := p_amount - v_from_free;

  if v_from_paid > v_paid then
    raise exception 'insufficient_credits' using detail = format('shortfall=%s', v_from_paid - v_paid);
  end if;

  if v_from_free > 0 then
    insert into credit_ledger (user_id, kind, delta, reason, room_id, submission_id, provider_cost_cents, free_tier)
    values (p_user_id, p_kind, -v_from_free, p_reason, p_room_id, p_submission_id, p_provider_cost_cents, true)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  if v_from_paid > 0 then
    insert into credit_ledger (user_id, kind, delta, reason, room_id, submission_id, provider_cost_cents, free_tier)
    values (p_user_id, p_kind, -v_from_paid, p_reason, p_room_id, p_submission_id, p_provider_cost_cents, false)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  return v_ids;
end $$;

-- Refund every spend tied to a submission (e.g. lost the window, moderation reject).
-- Idempotent: skips if a refund for the submission already exists.
create or replace function refund_submission(p_submission_id uuid, p_reason text default 'queue_refund')
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer := 0;
begin
  if exists (select 1 from credit_ledger where submission_id = p_submission_id and delta > 0) then
    return 0;
  end if;
  insert into credit_ledger (user_id, kind, delta, reason, room_id, submission_id, free_tier)
  select user_id, kind, -delta, p_reason, room_id, submission_id, free_tier
  from credit_ledger
  where submission_id = p_submission_id and delta < 0;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function credit_balances(uuid, credit_kind) from public, anon, authenticated;
revoke execute on function grant_credits(uuid, credit_kind, integer, text, boolean, text) from public, anon, authenticated;
revoke execute on function spend_credits(uuid, credit_kind, integer, text, uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function refund_submission(uuid, text) from public, anon, authenticated;
revoke execute on function credit_balance(uuid, credit_kind) from public, anon, authenticated;
grant execute on function my_credit_balances() to authenticated;
