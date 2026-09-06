import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Server only. Bypasses RLS — use it exclusively inside
 * trusted server code (queue resolution, credit ledger writes, moderation).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env vars missing");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
