import Link from "next/link";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RoomsPage() {
  if (!hasSupabaseEnv()) return <main className="p-6">Supabase is not configured.</main>;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, slug, name, type, visibility, mode, owner_id, current_asset_url")
    .order("visibility", { ascending: false })
    .order("updated_at", { ascending: false });

  const publicRooms = (rooms ?? []).filter((r) => r.visibility === "public");
  const privateRooms = (rooms ?? []).filter((r) => r.visibility === "private");

  return (
    <main className="mx-auto w-full max-w-5xl space-y-10 p-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Public rooms</h1>
          {user && (
            <Link href="/rooms/new" className="text-sm underline">
              New room
            </Link>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {publicRooms.map((r) => (
            <Link key={r.id} href={`/rooms/${r.slug}`} className="group overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="aspect-square bg-zinc-100 dark:bg-zinc-900">
                {r.current_asset_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.current_asset_url} alt={r.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-400">empty canvas</div>
                )}
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium group-hover:underline">{r.name}</span>
                <span className="text-xs text-zinc-500">{r.type}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {user && (
        <section>
          <h2 className="mb-3 text-lg font-medium">Your private rooms</h2>
          {privateRooms.length === 0 ? (
            <p className="text-sm text-zinc-500">None yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {privateRooms.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <Link href={`/rooms/${r.slug}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-xs text-zinc-500">
                    {r.type} · {r.mode}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
