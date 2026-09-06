-- Local/dev seed: a system account and one public art wall.
-- Safe to re-run (db reset applies migrations then this file).
-- Note: GoTrue requires the token/change columns to be '' rather than NULL.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  email_change_confirm_status, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated',
  'system@collabspace.local',
  crypt('not-for-login-' || gen_random_uuid()::text, gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"collabspace"}'::jsonb,
  now(), now(),
  '', '', '', '', '', '', '', '',
  0, false, false
) on conflict (id) do nothing;

insert into public.rooms (id, slug, name, type, visibility, mode, owner_id, rules,
  base_window_seconds, premium_window_seconds, base_price_credits, premium_min_bid_credits,
  premium_bid_increment_credits, instant_price_credits)
values (
  '00000000-0000-0000-0000-00000000a001', 'the-wall', 'The Wall', 'art', 'public', 'queue',
  '00000000-0000-0000-0000-000000000001', '{"max_prompt_words": 6}'::jsonb,
  120, 120, 1, 5, 1, 20
) on conflict (slug) do nothing;

insert into public.room_participants (room_id, user_id, role)
values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001', 'owner')
on conflict do nothing;
