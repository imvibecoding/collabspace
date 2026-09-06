-- Service-role helper to resolve an email to a user id without the auth admin API.
create or replace function find_user_id_by_email(p_email text)
returns uuid
language sql security definer stable set search_path = public as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke execute on function find_user_id_by_email(text) from public, anon, authenticated;
