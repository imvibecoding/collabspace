"use client";

import { useMemo, useState } from "react";
import type { WorldEntity, WorldState } from "@/lib/world/types";
import { entityFill } from "@/lib/world/generators";
import { isoDepth, isoFootprintCorners, isoViewBox, pointsAttr, raise, shade, toIso } from "@/lib/world/iso";
import { zoneCenter } from "@/lib/world/zones";

export type EntityMeta = { submissionId?: string; userId?: string; prompt?: string };

const BOX_KINDS = new Set(["building", "vehicle", "prop", "sign"]);
const FLAT_KINDS = new Set(["road", "water"]);
// Everything else (tree, character, animal, scene) renders as a billboard.

/**
 * Isometric world renderer. Pure presentation: an SVG whose coordinate space
 * is shared with the generated background (see src/lib/world/generators.ts),
 * so entities line up with the map without any extra alignment work.
 * Buildings/vehicles/props/signs extrude as shaded boxes; trees/characters/
 * animals/scenes render as grounded billboards; roads/water stay flat.
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
  const vb = useMemo(() => isoViewBox(world.width, world.height), [world.width, world.height]);
  const sorted = useMemo(
    () => [...world.entities].sort((a, b) => isoDepth(a.x + a.w / 2, a.y + a.h / 2) - isoDepth(b.x + b.w / 2, b.y + b.h / 2)),
    [world.entities],
  );

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 ${className ?? ""}`}
      style={{ aspectRatio: `${vb.width} / ${vb.height}` }}
    >
      {!world.backgroundUrl && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500">Generating the base world…</div>
      )}
      <svg
        viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`}
        className="absolute inset-0 h-full w-full"
        onClick={() => onSelect?.(null)}
      >
        {world.backgroundUrl && <image href={world.backgroundUrl} x={vb.minX} y={vb.minY} width={vb.width} height={vb.height} preserveAspectRatio="none" />}

        {world.zones.map((zone) => {
          const c = toIso(zoneCenter(zone).x, zoneCenter(zone).y);
          return (
            <text
              key={zone.id}
              x={c.x}
              y={c.y}
              textAnchor="middle"
              className="pointer-events-none select-none"
              style={{ fontSize: world.width * 0.045, fontWeight: 700, fill: "#ffffff", opacity: 0.6, paintOrder: "stroke", stroke: "#00000066", strokeWidth: world.width * 0.006, letterSpacing: 1 }}
            >
              {zone.name}
            </text>
          );
        })}

        {sorted.map((e) => {
          const meta = e.meta as EntityMeta;
          const selected = e.id === selectedId;
          const highlighted = Boolean(highlightSubmissionId && meta.submissionId === highlightSubmissionId);
          return (
            <EntityShape
              key={e.id}
              entity={e}
              emphasized={selected || highlighted}
              hovered={hover === e.id}
              onHover={setHover}
              onSelect={onSelect}
            />
          );
        })}
      </svg>
    </div>
  );
}

function EntityShape({
  entity: e,
  emphasized,
  hovered,
  onHover,
  onSelect,
}: {
  entity: WorldEntity;
  emphasized: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect?: (entity: WorldEntity | null) => void;
}) {
  const fill = entityFill(e);
  const outline = emphasized ? "#ffffff" : "none";
  const outlineWidth = emphasized ? 2.5 : 0;
  const brighten = hovered ? 1.12 : 1;

  const handlers = {
    onMouseEnter: () => onHover(e.id),
    onMouseLeave: () => onHover(null),
    onClick: (ev: React.MouseEvent) => {
      ev.stopPropagation();
      onSelect?.(e);
    },
    onKeyDown: (ev: React.KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        onSelect?.(e);
      }
    },
  };

  if (FLAT_KINDS.has(e.kind)) {
    const c = isoFootprintCorners(e);
    return (
      <g role="button" tabIndex={0} aria-label={e.name} className="cursor-pointer outline-none" {...handlers}>
        <title>{e.name}</title>
        <polygon
          points={pointsAttr([c.back, c.right, c.front, c.left])}
          fill={shade(fill, brighten)}
          opacity={e.kind === "water" ? 0.85 : 0.95}
          stroke={outline}
          strokeWidth={outlineWidth}
        />
      </g>
    );
  }

  if (BOX_KINDS.has(e.kind)) {
    const c = isoFootprintCorners(e);
    const rTop = raise(c.right, e.height);
    const rFront = raise(c.front, e.height);
    const rLeft = raise(c.left, e.height);
    const rBack = raise(c.back, e.height);
    const south = [c.left, c.front, rFront, rLeft];
    const east = [c.front, c.right, rTop, rFront];
    const top = [rBack, rTop, rFront, rLeft];
    return (
      <g role="button" tabIndex={0} aria-label={e.name} className="cursor-pointer outline-none" {...handlers}>
        <title>{e.name}</title>
        <polygon points={pointsAttr([c.back, c.right, c.front, c.left])} fill="#000000" opacity={0.15} />
        {e.height > 0 ? (
          <>
            <polygon points={pointsAttr(south)} fill={shade(fill, 0.72 * brighten)} stroke={outline} strokeWidth={outlineWidth} />
            <polygon points={pointsAttr(east)} fill={shade(fill, 0.56 * brighten)} stroke={outline} strokeWidth={outlineWidth} />
            <polygon points={pointsAttr(top)} fill={shade(fill, 1.0 * brighten)} stroke={outline} strokeWidth={outlineWidth} />
          </>
        ) : (
          <polygon points={pointsAttr([c.back, c.right, c.front, c.left])} fill={shade(fill, brighten)} stroke={outline} strokeWidth={outlineWidth} />
        )}
      </g>
    );
  }

  // Billboard: a grounded shadow plus a raised circle/trunk for tree, character, animal, scene.
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const base = toIso(cx, cy);
  const radius = Math.max(4, Math.min(e.w, e.h) / 2);
  const top = raise(base, e.height + radius * (e.kind === "tree" ? 1 : 0.6));
  return (
    <g role="button" tabIndex={0} aria-label={e.name} className="cursor-pointer outline-none" {...handlers}>
      <title>{e.name}</title>
      <ellipse cx={base.x} cy={base.y} rx={radius * 0.9} ry={radius * 0.35} fill="#000000" opacity={0.25} />
      {e.height > 0 && <line x1={base.x} y1={base.y} x2={top.x} y2={top.y} stroke={shade(fill, 0.5)} strokeWidth={Math.max(2, radius * 0.18)} />}
      <circle cx={top.x} cy={top.y} r={radius} fill={shade(fill, brighten)} stroke={outline} strokeWidth={outlineWidth} />
      {e.kind === "tree" && <circle cx={top.x - radius * 0.3} cy={top.y - radius * 0.3} r={radius * 0.4} fill={shade(fill, 1.3)} opacity={0.6} />}
    </g>
  );
}
