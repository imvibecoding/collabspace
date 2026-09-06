import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureMonthlyGrant, getBalances } from "@/lib/credits/ledger";

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app");

  await ensureMonthlyGrant(user.id);
  const [balances, { data: rooms }, { data: rep }] = await Promise.all([
    getBalances(user.id),
    supabase
      .from("rooms")
      .select("id, slug, name, type, visibility, mode, owner_id, updated_at")
      .order("updated_at", { ascending: false }),
    supabase.from("reputation_scores").select("*").eq("user_id", user.id).maybeSingle(),
  ]);

  const shownKinds = (["image", "priority", "text"] as const).filter((k) => balances[k].free + balances[k].paid > 0 || k === "image");

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 p-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My space</h1>
          <p className="text-sm text-zinc-500">{user.email}</p>
        </div>
        <Link href="/rooms/new" className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-black">
          New room
        </Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {shownKinds.map((k) => (
          <div key={k} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{k} credits</div>
            <div className="mt-1 text-2xl font-semibold">{balances[k].free + balances[k].paid}</div>
            <div className="text-xs text-zinc-500">
              {balances[k].free} free (public rooms) · {balances[k].paid} paid
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Reputation</div>
          <div className="mt-1 text-2xl font-semibold">{Number(rep?.score ?? 1).toFixed(2)}</div>
          <div className="text-xs text-zinc-500">
            {rep?.strikes ?? 0} strikes · penalty {rep?.priority_penalty ?? 0}
            {rep?.cooldown_until && new Date(rep.cooldown_until) > new Date()
              ? ` · cooldown until ${new Date(rep.cooldown_until).toLocaleTimeString()}`
              : ""}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Rooms you can see</h2>
        {rooms && rooms.length > 0 ? (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rooms.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link href={`/rooms/${r.slug}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
                <span className="text-xs text-zinc-500">
                  {r.type} · {r.visibility} · {r.mode}
                  {r.owner_id === user.id ? " · owner" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No rooms yet. Create one or join The Wall.</p>
        )}
      </section>
    </main>
  );
}
