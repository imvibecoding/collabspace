import Link from "next/link";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export async function Nav() {
  let email: string | null = null;
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? null;
  }
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 text-sm dark:border-zinc-800">
      <nav className="flex items-center gap-5">
        <Link href="/" className="font-semibold tracking-tight">
          collabspace
        </Link>
        <Link href="/rooms" className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white">
          Rooms
        </Link>
        {email && (
          <Link href="/app" className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white">
            My space
          </Link>
        )}
      </nav>
      <div className="flex items-center gap-4">
        {email ? (
          <>
            <span className="text-zinc-500">{email}</span>
            <form action={signOut}>
              <button className="underline" type="submit">
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/login" className="underline">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
