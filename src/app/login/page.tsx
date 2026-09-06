import Link from "next/link";
import { signIn, signUp } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; mode?: string }>;
}) {
  const { next = "/app", error, mode = "signin" } = await searchParams;
  const isSignUp = mode === "signup";
  const action = isSignUp ? signUp : signIn;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold">{isSignUp ? "Create account" : "Sign in"}</h1>
        <p className="text-sm text-zinc-500">
          You need an account to participate in rooms. Viewing public rooms is free.
        </p>
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>
        <label className="block text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Password</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>
        {isSignUp && (
          <label className="block text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Display name</span>
            <input
              name="display_name"
              type="text"
              maxLength={40}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            />
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black"
        >
          {isSignUp ? "Create account" : "Sign in"}
        </button>
        <p className="text-center text-sm text-zinc-500">
          {isSignUp ? (
            <>
              Have an account?{" "}
              <Link className="underline" href={`/login?next=${encodeURIComponent(next)}`}>
                Sign in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link className="underline" href={`/login?mode=signup&next=${encodeURIComponent(next)}`}>
                Create an account
              </Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
