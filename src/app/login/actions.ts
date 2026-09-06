"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/app";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/app";
}

function fail(mode: "signin" | "signup", next: string, message: string): never {
  const params = new URLSearchParams({ next, error: message });
  if (mode === "signup") params.set("mode", "signup");
  redirect(`/login?${params.toString()}`);
}

export async function signIn(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail("signin", next, error.message);
  redirect(next);
}

export async function signUp(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const display_name = String(formData.get("display_name") ?? "").trim() || undefined;
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name } },
  });
  if (error) fail("signup", next, error.message);
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
