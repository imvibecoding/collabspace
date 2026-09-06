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
  const type = formData.get("type") === "kanban" ? "kanban" : "art";
  const visibility = formData.get("visibility") === "public" ? "public" : "private";
  if (!name) redirect("/rooms/new?error=Name%20is%20required");

  const room = await createRoom({ ownerId: user.id, name, type, visibility });
  redirect(`/rooms/${room.slug}`);
}
