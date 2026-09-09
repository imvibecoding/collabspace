"use client";

import dynamic from "next/dynamic";

/** three.js needs the DOM; load the scene on the client only. */
export const World3DClient = dynamic(() => import("./world-3d").then((m) => m.World3D), {
  ssr: false,
  loading: () => (
    <div className="flex w-full items-center justify-center rounded-xl border border-zinc-200 bg-zinc-900 text-sm text-zinc-400 dark:border-zinc-800" style={{ aspectRatio: "16 / 10" }}>
      Loading the city…
    </div>
  ),
});
