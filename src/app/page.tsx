import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function fetchHealth() {
  if (!hasSupabaseEnv()) {
    return { status: "unconfigured" as const, message: "Supabase env vars not set" };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("health_check")
      .select("id, label, created_at")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return { status: "error" as const, message: error.message };
    if (!data) return { status: "empty" as const, message: "health_check table has no rows" };
    return { status: "ok" as const, message: `${data.label} (row ${data.id})` };
  } catch (e) {
    return { status: "error" as const, message: (e as Error).message };
  }
}

export default async function Home() {
  const health = await fetchHealth();
  const tone =
    health.status === "ok"
      ? "text-emerald-600"
      : health.status === "unconfigured"
        ? "text-amber-600"
        : "text-red-600";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 font-sans">
      <h1 className="text-4xl font-semibold tracking-tight">collabspace</h1>
      <p className="text-zinc-500">Collaborative prompt-economy platform. Hello, world.</p>
      <div className="rounded-lg border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
        <span className="text-zinc-500">Supabase: </span>
        <span className={tone}>{health.status}</span>
        <span className="text-zinc-400"> — {health.message}</span>
      </div>
    </main>
  );
}
