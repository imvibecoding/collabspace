import Link from "next/link";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  let health = "unconfigured";
  let wall: { slug: string; name: string; current_asset_url: string | null } | null = null;
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("health_check").select("id").limit(1).maybeSingle();
    health = error ? `error: ${error.message}` : data ? "ok" : "empty";
    const { data: room } = await supabase.from("rooms").select("slug, name, current_asset_url").eq("slug", "the-wall").maybeSingle();
    wall = room;
  }
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="space-y-3">
        <h1 className="text-5xl font-semibold tracking-tight">collabspace</h1>
        <p className="max-w-xl text-zinc-500">
          Make things together. Public walls run on a fair, credit-gated prompt queue. Private rooms give small teams
          shared boards and canvases with adaptive collaboration modes.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {wall && (
          <Link href={`/rooms/${wall.slug}`} className="rounded-md bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-black">
            Join {wall.name}
          </Link>
        )}
        <Link href="/rooms" className="rounded-md border border-zinc-300 px-4 py-2 dark:border-zinc-700">
          Browse rooms
        </Link>
        <Link href="/rooms/new" className="rounded-md border border-zinc-300 px-4 py-2 dark:border-zinc-700">
          Create a room
        </Link>
      </div>
      <p className="text-xs text-zinc-400">supabase: {health}</p>
    </main>
  );
}
