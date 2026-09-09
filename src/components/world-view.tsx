"use client";

import { useMemo, useState } from "react";
import type { WorldEntity, WorldState } from "@/lib/world/types";
import { entityFill } from "@/lib/world/generators";

export type EntityMeta = { submissionId?: string; userId?: string; prompt?: string };

/**
 * Top-down 2D world renderer. Pure presentation: background map plus
 * absolutely-positioned sprites, scaled to fit the container. Entities are
 * clickable so the room can show provenance and a downvote control.
 */
export function WorldView({
  world,
  selectedId,
  onSelect,
  highlightSubmissionId,
  className,
}: {
  world: WorldState;
  selectedId?: string | null;
  onSelect?: (entity: WorldEntity | null) => void;
  highlightSubmissionId?: string | null;
  className?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...world.entities].sort((a, b) => zIndex(a) - zIndex(b) || a.y - b.y),
    [world.entities],
  );

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 ${className ?? ""}`}
      style={{ aspectRatio: `${world.width} / ${world.height}` }}
      onClick={() => onSelect?.(null)}
    >
      {world.backgroundUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={world.backgroundUrl} alt="" className="absolute inset-0 h-full w-full select-none" draggable={false} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-400">Generating the base world…</div>
      )}
      {sorted.map((e) => {
        const meta = e.meta as EntityMeta;
        const selected = e.id === selectedId;
        const highlighted = highlightSubmissionId && meta.submissionId === highlightSubmissionId;
        const style = {
          left: `${(e.x / world.width) * 100}%`,
          top: `${(e.y / world.height) * 100}%`,
          width: `${(e.w / world.width) * 100}%`,
          height: `${(e.h / world.height) * 100}%`,
          transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
          transformOrigin: "center",
        } as const;
        return (
          <button
            key={e.id}
            type="button"
            title={e.name}
            aria-label={e.name}
            style={style}
            onMouseEnter={() => setHover(e.id)}
            onMouseLeave={() => setHover(null)}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect?.(e);
            }}
            className={`absolute p-0 ${selected || highlighted ? "z-20 ring-2 ring-white drop-shadow-[0_0_6px_rgba(255,255,255,0.9)]" : hover === e.id ? "z-10 brightness-110" : ""}`}
          >
            {e.spriteUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.spriteUrl} alt="" className="h-full w-full select-none" draggable={false} />
            ) : (
              <div className="h-full w-full rounded-sm border border-black/40" style={{ background: entityFill(e) }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function zIndex(e: WorldEntity): number {
  switch (e.kind) {
    case "water":
      return 0;
    case "road":
      return 1;
    case "scene":
      return 2;
    case "building":
      return 3;
    case "tree":
      return 4;
    case "prop":
    case "sign":
      return 5;
    case "vehicle":
      return 6;
    default:
      return 7;
  }
}
