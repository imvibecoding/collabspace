-- collabspace initial schema
-- Every table has RLS enabled. Private rooms are private at the DB layer.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type room_type as enum ('art', 'kanban');
create type room_visibility as enum ('public', 'private');
create type collab_mode as enum ('freeform', 'queue', 'sectioned');
create type participant_role as enum ('owner', 'editor', 'viewer');
create type queue_lane as enum ('base', 'premium', 'instant');
create type submission_status as enum ('pending', 'applied', 'rejected', 'reverted', 'expired');
create type credit_kind as enum ('text', 'image', 'music', 'video', 'threed', 'priority', 'hosting', 'universal');
create type flag_status as enum ('open', 'reviewing', 'upheld', 'dismissed');

-- ---------------------------------------------------------------------------
-- Health check (used by the hello-world deploy)
-- ---------------------------------------------------------------------------
create table health_check (
  id bigint generated always as identity primary key,
  label text not null,
  created_at timestamptz not null default now()
);
insert into health_check (label) values ('ok');
alter table health_check enable row level security;
create policy "health_check readable by anyone" on health_check for select using (true);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users) and reputation
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  display_name text,
  avatar_url text,
  phone_verified boolean not null default false,
  card_on_file boolean not null default false,
  banned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "profiles readable by authenticated" on profiles for select to authenticated using (true);
create policy "users update own profile" on profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create table reputation_scores (
  user_id uuid primary key references profiles(id) on delete cascade,
  score numeric not null default 1.0,          -- downvote weight multiplier
  priority_penalty integer not null default 0, -- nudges queue priority down
  cooldown_until timestamptz,
  strikes integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table reputation_scores enable row level security;
create policy "users read own reputation" on reputation_scores for select to authenticated using (auth.uid() = user_id);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1)));
  insert into public.reputation_scores (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Rooms & participants
-- ---------------------------------------------------------------------------
create table rooms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  type room_type not null,
  visibility room_visibility not null default 'private',
  mode collab_mode not null default 'freeform',
  owner_id uuid not null references profiles(id) on delete restrict,
  rules jsonb not null default '{}'::jsonb,   -- room-specific constraints e.g. {"max_prompt_words": 6}
  base_window_seconds integer not null default 300,
  premium_window_seconds integer not null default 300,
  base_price_credits integer not null default 1,
  premium_min_bid_credits integer not null default 5,
  premium_bid_increment_credits integer not null default 1,
  instant_price_credits integer not null default 20,
  current_asset_url text,
  current_submission_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table rooms enable row level security;

create table room_participants (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role participant_role not null default 'editor',
  invited_by uuid references profiles(id),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table room_participants enable row level security;

-- Helpers (security definer avoids RLS recursion between rooms <-> participants)
create or replace function is_room_participant(p_room_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from room_participants where room_id = p_room_id and user_id = auth.uid());
$$;
create or replace function is_room_owner(p_room_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from rooms where id = p_room_id and owner_id = auth.uid());
$$;
create or replace function room_is_public(p_room_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from rooms where id = p_room_id and visibility = 'public');
$$;
create or replace function can_view_room(p_room_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select room_is_public(p_room_id) or is_room_participant(p_room_id) or is_room_owner(p_room_id);
$$;
create or replace function can_edit_room(p_room_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_room_participant(p_room_id) or is_room_owner(p_room_id);
$$;

create policy "public rooms visible to all" on rooms for select using (visibility = 'public');
create policy "private rooms visible to participants" on rooms for select to authenticated using (can_edit_room(id));
create policy "authenticated can create rooms" on rooms for insert to authenticated with check (owner_id = auth.uid());
create policy "owner updates room" on rooms for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes room" on rooms for delete to authenticated using (owner_id = auth.uid());

create policy "participants see co-participants" on room_participants for select to authenticated using (can_edit_room(room_id));
create policy "owner adds participants" on room_participants for insert to authenticated with check (is_room_owner(room_id));
create policy "owner removes participants or self leaves" on room_participants for delete to authenticated using (is_room_owner(room_id) or user_id = auth.uid());

-- Mode change log (drives "suggest mode change" UI + history)
create table room_mode_changes (
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  from_mode collab_mode,
  to_mode collab_mode not null,
  suggested boolean not null default false,  -- true if system-suggested
  accepted boolean,                          -- null = pending suggestion
  reason text,
  changed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
alter table room_mode_changes enable row level security;
create policy "mode changes readable in visible rooms" on room_mode_changes for select using (can_view_room(room_id));
create policy "editors write mode changes" on room_mode_changes for insert to authenticated with check (can_edit_room(room_id));
create policy "owner resolves suggestions" on room_mode_changes for update to authenticated using (is_room_owner(room_id));

-- ---------------------------------------------------------------------------
-- Credit ledger (append-only; only the service role writes it)
-- ---------------------------------------------------------------------------
create table credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind credit_kind not null default 'universal',
  delta integer not null,                          -- positive = grant/purchase, negative = spend
  reason text not null,                            -- 'monthly_grant' | 'purchase' | 'queue_submission' | 'refund' | ...
  room_id uuid references rooms(id) on delete set null,
  submission_id uuid,                              -- fk added after queue_submissions exists
  provider_cost_cents integer,                     -- actual upstream cost, for markup tracking
  stripe_ref text,
  free_tier boolean not null default false,        -- free credits are valid in public rooms only
  created_at timestamptz not null default now()
);
create index credit_ledger_user_idx on credit_ledger (user_id, kind, created_at desc);
alter table credit_ledger enable row level security;
create policy "users read own ledger" on credit_ledger for select to authenticated using (auth.uid() = user_id);

create or replace function credit_balance(p_user_id uuid, p_kind credit_kind default 'universal')
returns integer language sql security definer stable set search_path = public as $$
  select coalesce(sum(delta), 0)::integer from credit_ledger where user_id = p_user_id and kind = p_kind;
$$;

-- ---------------------------------------------------------------------------
-- Queue engine
-- ---------------------------------------------------------------------------
create table queue_submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  lane queue_lane not null default 'base',
  prompt text not null,
  provider text,                                   -- image provider key
  bid_credits integer not null default 0,
  status submission_status not null default 'pending',
  window_start timestamptz not null,               -- resolution window this belongs to
  moderation jsonb not null default '{}'::jsonb,   -- pre-gen filter result
  result_asset_url text,
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);
create index queue_submissions_room_window_idx on queue_submissions (room_id, lane, window_start, status);
alter table queue_submissions enable row level security;
create policy "submissions readable in visible rooms" on queue_submissions for select using (can_view_room(room_id));
create policy "members submit" on queue_submissions for insert to authenticated with check (user_id = auth.uid() and can_view_room(room_id));

alter table credit_ledger add constraint credit_ledger_submission_fk foreign key (submission_id) references queue_submissions(id) on delete set null;
alter table rooms add constraint rooms_current_submission_fk foreign key (current_submission_id) references queue_submissions(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Kanban
-- ---------------------------------------------------------------------------
create table kanban_columns (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  title text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
alter table kanban_columns enable row level security;
create policy "members read columns" on kanban_columns for select to authenticated using (can_edit_room(room_id));
create policy "members write columns" on kanban_columns for all to authenticated using (can_edit_room(room_id)) with check (can_edit_room(room_id));

create table kanban_cards (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  column_id uuid not null references kanban_columns(id) on delete cascade,
  title text not null,
  body text,
  position integer not null default 0,
  locked_by uuid references profiles(id) on delete set null,
  locked_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kanban_cards_column_idx on kanban_cards (column_id, position);
alter table kanban_cards enable row level security;
create policy "members read cards" on kanban_cards for select to authenticated using (can_edit_room(room_id));
create policy "members insert cards" on kanban_cards for insert to authenticated with check (can_edit_room(room_id));
-- Sectioned/locked ownership: a locked card is editable only by its locker.
create policy "members update unlocked or own-locked cards" on kanban_cards for update to authenticated
  using (can_edit_room(room_id) and (locked_by is null or locked_by = auth.uid()))
  with check (can_edit_room(room_id));
create policy "members delete unlocked or own-locked cards" on kanban_cards for delete to authenticated
  using (can_edit_room(room_id) and (locked_by is null or locked_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- Action history (GitHub-style, per room)
-- ---------------------------------------------------------------------------
create table action_history (
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,                  -- 'submission.applied' | 'card.moved' | 'mode.changed' | ...
  target_type text,
  target_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index action_history_room_idx on action_history (room_id, created_at desc);
alter table action_history enable row level security;
create policy "history readable in visible rooms" on action_history for select using (can_view_room(room_id));
create policy "members append history" on action_history for insert to authenticated with check (actor_id = auth.uid() and can_view_room(room_id));

-- ---------------------------------------------------------------------------
-- Moderation flags / downvotes
-- ---------------------------------------------------------------------------
create table moderation_flags (
  id bigint generated always as identity primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  submission_id uuid references queue_submissions(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  kind text not null default 'downvote',   -- 'downvote' | 'report'
  weight numeric not null default 1.0,     -- reporter reputation at time of flag
  reason text,
  status flag_status not null default 'open',
  created_at timestamptz not null default now(),
  unique (submission_id, reporter_id, kind)
);
alter table moderation_flags enable row level security;
create policy "users read own flags" on moderation_flags for select to authenticated using (reporter_id = auth.uid());
create policy "members flag" on moderation_flags for insert to authenticated with check (reporter_id = auth.uid() and can_view_room(room_id));

-- Snapshots (frozen room states)
create table snapshots (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  asset_url text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table snapshots enable row level security;
create policy "snapshots readable in visible rooms" on snapshots for select using (can_view_room(room_id));
create policy "members create snapshots" on snapshots for insert to authenticated with check (created_by = auth.uid() and can_view_room(room_id));

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_updated_at before update on profiles for each row execute function set_updated_at();
create trigger rooms_updated_at before update on rooms for each row execute function set_updated_at();
create trigger kanban_cards_updated_at before update on kanban_cards for each row execute function set_updated_at();

-- Realtime for queue + kanban
alter publication supabase_realtime add table queue_submissions, kanban_cards, kanban_columns, rooms, room_mode_changes;
