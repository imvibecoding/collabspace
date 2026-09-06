"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to the room's tables and refresh server-rendered data on change.
 * `tick` re-renders on an interval so queue countdowns advance and closed
 * windows get resolved by the page's opportunistic resolver.
 */
export function useRoomRealtime(roomId: string, tables: string[], tickMs = 0) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let channel = supabase.channel(`room:${roomId}`);
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `room_id=eq.${roomId}` },
        () => router.refresh(),
      );
    }
    channel = channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
      () => router.refresh(),
    );
    channel.subscribe();
    const timer = tickMs > 0 ? setInterval(() => router.refresh(), tickMs) : null;
    return () => {
      supabase.removeChannel(channel);
      if (timer) clearInterval(timer);
    };
  }, [roomId, router, tables.join(","), tickMs]); // eslint-disable-line react-hooks/exhaustive-deps
}
