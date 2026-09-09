"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRoom } from "@/lib/rooms/service";
import { InsufficientCreditsError } from "@/lib/credits/ledger";

export async function createRoomAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/rooms/new");

  const name = String(formData.get("name") ?? "").trim();
  const typeRaw = String(formData.get("type") ?? "world");
  const type = typeRaw === "kanban" ? "kanban" : typeRaw === "art" ? "art" : "world";
  const worldPrompt = String(formData.get("world_prompt") ?? "").trim();
  const worldCity = formData.get("world_city") === "1";
  const visibility = formData.get("visibility") === "public" ? "public" : "private";
  if (!name) redirect("/rooms/new?error=Name%20is%20required");

  let room;
  try {
    room = await createRoom({ ownerId: user.id, name, type, visibility, worldPrompt: worldPrompt || undefined, worldCity });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      redirect(`/rooms/new?error=${encodeURIComponent(`Not enough credits to create that room (short ${e.shortfall}).`)}`);
    }
    throw e;
  }
  redirect(`/rooms/${room.slug}`);
}
