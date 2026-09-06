import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Snapshot view: a frozen, shareable, read-only state of a room. */
export default async function SnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: snap } = await supabase.from("snapshots").select("*, rooms(name, slug)").eq("id", id).maybeSingle();
  if (!snap) notFound();
  const state = (snap.state ?? {}) as { paid?: boolean };
  const room = snap.rooms as { name: string; slug: string } | null;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between text-sm">
        <h1 className="text-xl font-semibold">{room?.name ?? "Snapshot"}</h1>
        <span className="text-xs text-zinc-500">
          {state.paid ? "Print" : "Snapshot"} · {new Date(snap.created_at).toLocaleString()}
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        {snap.asset_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={snap.asset_url} alt="snapshot" className="w-full" />
        ) : (
          <div className="p-10 text-center text-zinc-400">No image</div>
        )}
      </div>
      <p className="text-sm text-zinc-500">
        This is a frozen state and cannot be edited.{" "}
        {room && (
          <Link href={`/rooms/${room.slug}`} className="underline">
            Go to the live room
          </Link>
        )}
      </p>
    </main>
  );
}
