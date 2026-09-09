"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRoom } from "@/lib/rooms/service";

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

  const room = await createRoom({ ownerId: user.id, name, type, visibility, worldPrompt: worldPrompt || undefined, worldCity });
  redirect(`/rooms/${room.slug}`);
}
