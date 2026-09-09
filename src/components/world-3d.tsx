"use client";
/* eslint-disable react-hooks/immutability -- three.js cameras/objects are mutated in place by design */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { generateCity, type CityLayout } from "@/lib/world/city";
import { entityFill } from "@/lib/world/generators";
import { dateAtLocalHour, daylightAt, palette, type Daylight } from "@/lib/world/sun";
import type { WorldEntity, WorldState } from "@/lib/world/types";
import { zoneCenter } from "@/lib/world/zones";

export type EntityMeta = { submissionId?: string; userId?: string; prompt?: string; lotId?: string };

/** "iso" = the angled city view; "top" = straight-down bird's-eye of the same world. */
export type ViewMode = "iso" | "top";

/* ----------------------------- coordinates ------------------------------- */
// World: x east, y south (top-down). Three: X east, Z south, Y up, origin at the map centre.

function toX(world: WorldState, x: number) {
  return x - world.width / 2;
}
function toZ(world: WorldState, y: number) {
  return y - world.height / 2;
}

/* ------------------------------ textures --------------------------------- */

function makeWindowTextures(seed: number) {
  const cells = 4;
  const px = 64;
  const size = cells * px;
  const albedo = document.createElement("canvas");
  const emissive = document.createElement("canvas");
  albedo.width = albedo.height = emissive.width = emissive.height = size;
  const a = albedo.getContext("2d")!;
  const e = emissive.getContext("2d")!;
  a.fillStyle = "#ffffff";
  a.fillRect(0, 0, size, size);
  e.fillStyle = "#000000";
  e.fillRect(0, 0, size, size);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = i * px + 12;
      const y = j * px + 10;
      const w = px - 24;
      const h = px - 22;
      a.fillStyle = "#6e7f94";
      a.fillRect(x, y, w, h);
      a.fillStyle = "#ffffff";
      a.fillRect(x + w / 2 - 1, y, 2, h);
      if (rnd() < 0.22) {
        const warm = rnd() < 0.7;
        e.fillStyle = warm ? "#ffd48a" : "#bfe3ff";
        e.fillRect(x, y, w, h);
      }
    }
  }
  const mk = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { albedo: mk(albedo), emissive: mk(emissive) };
}

/** One big ground texture: district tints, parks, roads with lane markings and tram tracks, water. */
function makeGroundTexture(world: WorldState, city: CityLayout) {
  const px = 2048;
  const k = px / world.width;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  g.fillStyle = "#7c7e72";
  g.fillRect(0, 0, px, px);
  for (const z of world.zones) {
    g.fillStyle = z.color;
    g.globalAlpha = 0.28;
    g.fillRect(z.bounds.x * k, z.bounds.y * k, z.bounds.w * k, z.bounds.h * k);
  }
  g.globalAlpha = 1;
  for (const p of city.parks) {
    g.fillStyle = "#5f8a4a";
    g.fillRect(p.x * k, p.y * k, p.w * k, p.h * k);
  }
  // Footpaths first, then the carriageway on top, so every block gets a kerb.
  g.fillStyle = "#9a978f";
  for (const r of city.roads) g.fillRect((r.x - 3) * k, (r.y - 3) * k, (r.w + 6) * k, (r.h + 6) * k);
  for (const r of city.roads) {
    g.fillStyle = "#3d3f42";
    g.fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
  }
  g.strokeStyle = "#cfc9a0";
  g.lineWidth = Math.max(1, 1.2 * k);
  g.setLineDash([10 * k, 12 * k]);
  for (const r of city.roads) {
    g.beginPath();
    if (r.axis === "v") {
      g.moveTo((r.x + r.w / 2) * k, r.y * k);
      g.lineTo((r.x + r.w / 2) * k, (r.y + r.h) * k);
    } else {
      g.moveTo(r.x * k, (r.y + r.h / 2) * k);
      g.lineTo((r.x + r.w) * k, (r.y + r.h / 2) * k);
    }
    g.stroke();
  }
  g.setLineDash([]);
  g.strokeStyle = "#8f8f8f";
  g.lineWidth = Math.max(1, 0.8 * k);
  for (const r of city.roads.filter((r) => r.tram)) {
    for (const off of [-2.2, 2.2]) {
      g.beginPath();
      if (r.axis === "v") {
        g.moveTo((r.x + r.w / 2 + off) * k, r.y * k);
        g.lineTo((r.x + r.w / 2 + off) * k, (r.y + r.h) * k);
      } else {
        g.moveTo(r.x * k, (r.y + r.h / 2 + off) * k);
        g.lineTo((r.x + r.w) * k, (r.y + r.h / 2 + off) * k);
      }
      g.stroke();
    }
  }
  g.fillStyle = "#2f5f8f";
  for (const w of [...city.river, ...(city.bay ? [city.bay] : [])]) g.fillRect(w.x * k, w.y * k, w.w * k, w.h * k);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------ geometry --------------------------------- */

const WINDOW_W = 4.6;
const WINDOW_H = 4.4;

/** Build merged wall + roof geometry for a set of boxes, with UVs tiled at window scale and per-box vertex colour. */
function buildBoxes(world: WorldState, boxes: Array<{ x: number; y: number; w: number; h: number; height: number; color: string; y0?: number }>) {
  const wallPos: number[] = [];
  const wallNorm: number[] = [];
  const wallUv: number[] = [];
  const wallCol: number[] = [];
  const wallIdx: number[] = [];
  const roofPos: number[] = [];
  const roofNorm: number[] = [];
  const roofCol: number[] = [];
  const roofIdx: number[] = [];
  const col = new THREE.Color();

  for (const b of boxes) {
    const x0 = toX(world, b.x);
    const x1 = toX(world, b.x + b.w);
    const z0 = toZ(world, b.y);
    const z1 = toZ(world, b.y + b.h);
    const y0 = b.y0 ?? 0;
    const y1 = y0 + b.height;
    col.set(b.color);
    const quad = (
      pos: number[], norm: number[], uv: number[] | null, colArr: number[], idx: number[],
      p: [number, number, number][], n: [number, number, number], uvw: number, uvh: number,
    ) => {
      const base = pos.length / 3;
      for (let i = 0; i < 4; i++) {
        pos.push(...p[i]);
        norm.push(...n);
        colArr.push(col.r, col.g, col.b);
      }
      if (uv) uv.push(0, 0, uvw, 0, uvw, uvh, 0, uvh);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const uw = (len: number) => Math.max(1, Math.round(len / WINDOW_W)) / 4;
    const uh = Math.max(1, Math.round(b.height / WINDOW_H)) / 4;
    // south (+Z), north (-Z), east (+X), west (-X)
    quad(wallPos, wallNorm, wallUv, wallCol, wallIdx, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], uw(b.w), uh);
    quad(wallPos, wallNorm, wallUv, wallCol, wallIdx, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], uw(b.w), uh);
    quad(wallPos, wallNorm, wallUv, wallCol, wallIdx, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], uw(b.h), uh);
    quad(wallPos, wallNorm, wallUv, wallCol, wallIdx, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], uw(b.h), uh);
    col.multiplyScalar(0.55);
    quad(roofPos, roofNorm, null, roofCol, roofIdx, [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0], 1, 1);
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute("position", new THREE.Float32BufferAttribute(wallPos, 3));
  walls.setAttribute("normal", new THREE.Float32BufferAttribute(wallNorm, 3));
  walls.setAttribute("uv", new THREE.Float32BufferAttribute(wallUv, 2));
  walls.setAttribute("color", new THREE.Float32BufferAttribute(wallCol, 3));
  walls.setIndex(wallIdx);
  const roofs = new THREE.BufferGeometry();
  roofs.setAttribute("position", new THREE.Float32BufferAttribute(roofPos, 3));
  roofs.setAttribute("normal", new THREE.Float32BufferAttribute(roofNorm, 3));
  roofs.setAttribute("color", new THREE.Float32BufferAttribute(roofCol, 3));
  roofs.setIndex(roofIdx);
  return { walls, roofs };
}

/* ------------------------------- scene ----------------------------------- */

function Lighting({ day }: { day: Daylight }) {
  const pal = palette(day);
  const sunDir = useMemo(() => {
    const r = 900;
    const alt = Math.max(day.altitude, -0.15);
    return new THREE.Vector3(Math.sin(day.azimuth) * Math.cos(alt) * r, Math.sin(alt) * r + 40, -Math.cos(day.azimuth) * Math.cos(alt) * r);
  }, [day.altitude, day.azimuth]);
  const sunIntensity = 0.15 + day.daylight * 2.2;
  const moon = (1 - day.daylight) * 0.35;
  return (
    <>
      <color attach="background" args={[pal.sky]} />
      <fog attach="fog" args={[pal.fog, 900, 2600]} />
      <hemisphereLight args={[pal.sky, "#3a3a33", 0.45 + day.daylight * 0.5]} />
      <ambientLight color={pal.ambient} intensity={0.45 + day.daylight * 0.3} />
      <directionalLight
        position={sunDir}
        color={pal.sun}
        intensity={sunIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-700}
        shadow-camera-right={700}
        shadow-camera-top={700}
        shadow-camera-bottom={-700}
        shadow-camera-near={10}
        shadow-camera-far={3000}
        shadow-bias={-0.0006}
      />
      <directionalLight position={[-300, 600, -200]} color="#9db4ff" intensity={moon} />
    </>
  );
}

function Stars({ day }: { day: Daylight }) {
  const geom = useMemo(() => {
    const n = 900;
    const pos = new Float32Array(n * 3);
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const b = rnd() * Math.PI * 0.45 + 0.1;
      const r = 2400;
      pos[i * 3] = Math.cos(a) * Math.cos(b) * r;
      pos[i * 3 + 1] = Math.sin(b) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(b) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const opacity = Math.max(0, 1 - day.daylight * 2.5);
  if (opacity <= 0) return null;
  return (
    <points geometry={geom}>
      <pointsMaterial size={3} color="#ffffff" transparent opacity={opacity} sizeAttenuation={false} fog={false} />
    </points>
  );
}

function Rain({ world, enabled }: { world: WorldState; enabled: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const { geom, n } = useMemo(() => {
    const n = 5000;
    const pos = new Float32Array(n * 3);
    let s = 1234;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * world.width * 1.2;
      pos[i * 3 + 1] = rnd() * 400;
      pos[i * 3 + 2] = (rnd() - 0.5) * world.height * 1.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geom: g, n };
  }, [world.width, world.height]);
  useFrame((_, dt) => {
    if (!enabled || !ref.current) return;
    const a = ref.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      let y = a.getY(i) - dt * 260;
      if (y < 0) y += 400;
      a.setY(i, y);
      a.setX(i, a.getX(i) - dt * 40);
    }
    a.needsUpdate = true;
  });
  if (!enabled) return null;
  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial size={1.6} color="#cfe3ff" transparent opacity={0.45} sizeAttenuation={false} />
    </points>
  );
}

function Ground({ world, city }: { world: WorldState; city: CityLayout }) {
  const tex = useMemo(() => makeGroundTexture(world, city), [world, city]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
      <planeGeometry args={[world.width, world.height]} />
      <meshStandardMaterial map={tex} roughness={0.95} metalness={0} />
    </mesh>
  );
}

function Water({ world, city, day }: { world: WorldState; city: CityLayout; day: Daylight }) {
  const rects = [...city.river, ...(city.bay ? [city.bay] : [])];
  return (
    <group>
      {rects.map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[toX(world, r.x + r.w / 2), 0.6, toZ(world, r.y + r.h / 2)]}>
          <planeGeometry args={[r.w, r.h]} />
          <meshStandardMaterial color={day.daylight > 0.5 ? "#3f7fb5" : "#1a3350"} roughness={0.15} metalness={0.6} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function CityBuildings({ world, city, takenLots, day }: { world: WorldState; city: CityLayout; takenLots: Set<string>; day: Daylight }) {
  const [texA, texB] = useMemo(() => [makeWindowTextures(11), makeWindowTextures(97)], []);
  const geoms = useMemo(() => {
    const lots = city.lots.filter((l) => !takenLots.has(l.id));
    const even = lots.filter((_, i) => i % 2 === 0);
    const odd = lots.filter((_, i) => i % 2 === 1);
    return { a: buildBoxes(world, even), b: buildBoxes(world, odd) };
  }, [world, city, takenLots]);
  useEffect(
    () => () => {
      geoms.a.walls.dispose();
      geoms.a.roofs.dispose();
      geoms.b.walls.dispose();
      geoms.b.roofs.dispose();
    },
    [geoms],
  );
  const glow = Math.pow(1 - day.daylight, 1.5) * 1.1;
  return (
    <group>
      {[
        { g: geoms.a, t: texA },
        { g: geoms.b, t: texB },
      ].map(({ g, t }, i) => (
        <group key={i}>
          <mesh geometry={g.walls} castShadow receiveShadow>
            <meshStandardMaterial map={t.albedo} emissiveMap={t.emissive} emissive="#ffffff" emissiveIntensity={glow} vertexColors roughness={0.7} metalness={0.05} />
          </mesh>
          <mesh geometry={g.roofs} castShadow receiveShadow>
            <meshStandardMaterial vertexColors roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Landmarks({ world, city, day }: { world: WorldState; city: CityLayout; day: Daylight }) {
  const glow = Math.pow(1 - day.daylight, 1.5);
  const at = (l: { x: number; y: number; w: number; h: number }) => [toX(world, l.x + l.w / 2), toZ(world, l.y + l.h / 2)] as const;
  return (
    <group>
      {city.landmarks.map((l) => {
        const [x, z] = at(l);
        switch (l.id) {
          case "eureka":
            return (
              <group key={l.id} position={[x, 0, z]}>
                <mesh position={[0, l.height * 0.44, 0]} castShadow>
                  <boxGeometry args={[l.w, l.height * 0.88, l.h]} />
                  <meshStandardMaterial color="#5f7fa8" roughness={0.25} metalness={0.5} emissive="#ffd48a" emissiveIntensity={glow * 0.6} />
                </mesh>
                <mesh position={[0, l.height * 0.94, 0]} castShadow>
                  <boxGeometry args={[l.w, l.height * 0.12, l.h]} />
                  <meshStandardMaterial color="#d4af37" roughness={0.3} metalness={0.8} emissive="#ffcc55" emissiveIntensity={0.15 + glow * 0.8} />
                </mesh>
              </group>
            );
          case "rialto":
            return (
              <group key={l.id} position={[x, 0, z]}>
                <mesh position={[-l.w * 0.22, l.height / 2, 0]} castShadow>
                  <boxGeometry args={[l.w * 0.5, l.height, l.h]} />
                  <meshStandardMaterial color="#5b6d85" roughness={0.3} metalness={0.5} />
                </mesh>
                <mesh position={[l.w * 0.26, l.height * 0.38, 0]} castShadow>
                  <boxGeometry args={[l.w * 0.44, l.height * 0.76, l.h * 0.9]} />
                  <meshStandardMaterial color="#6b7d95" roughness={0.3} metalness={0.5} />
                </mesh>
              </group>
            );
          case "spire":
            return (
              <group key={l.id} position={[x, 0, z]}>
                <mesh position={[0, l.height / 2, 0]}>
                  <coneGeometry args={[l.w / 2, l.height, 12, 1, true]} />
                  <meshStandardMaterial color="#e8e8f0" wireframe emissive="#ffffff" emissiveIntensity={glow * 1.2} />
                </mesh>
                <mesh position={[0, 6, 0]} castShadow>
                  <cylinderGeometry args={[l.w * 0.9, l.w * 0.9, 12, 24]} />
                  <meshStandardMaterial color="#cfc8b8" />
                </mesh>
              </group>
            );
          case "mcg":
            return (
              <group key={l.id} position={[x, 0, z]} scale={[1, 1, l.h / l.w]}>
                <mesh position={[0, l.height / 2, 0]} castShadow>
                  <cylinderGeometry args={[l.w / 2, l.w / 2 - 6, l.height, 48, 1, true]} />
                  <meshStandardMaterial color="#b9b9b9" side={THREE.DoubleSide} roughness={0.8} />
                </mesh>
                <mesh position={[0, l.height, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[l.w / 2 - 14, l.w / 2, 48]} />
                  <meshStandardMaterial color="#8a8a8a" side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[l.w / 2 - 12, 48]} />
                  <meshStandardMaterial color="#3f8a3a" />
                </mesh>
                {[0, 1, 2, 3].map((i) => (
                  <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * (l.w / 2 - 4), l.height + 18, Math.sin((i * Math.PI) / 2) * (l.w / 2 - 4)]}>
                    <boxGeometry args={[4, 36, 4]} />
                    <meshStandardMaterial color="#d0d0d0" emissive="#ffffff" emissiveIntensity={glow * 1.5} />
                  </mesh>
                ))}
              </group>
            );
          case "flinders":
            return (
              <group key={l.id} position={[x, 0, z]}>
                <mesh position={[0, l.height / 2, 0]} castShadow>
                  <boxGeometry args={[l.w, l.height, l.h]} />
                  <meshStandardMaterial color="#d8b25a" roughness={0.8} emissive="#ffb347" emissiveIntensity={glow * 0.35} />
                </mesh>
                <mesh position={[-l.w * 0.4, l.height + 6, 0]} castShadow>
                  <sphereGeometry args={[11, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
                  <meshStandardMaterial color="#8fb4a0" roughness={0.6} />
                </mesh>
                <mesh position={[l.w * 0.42, l.height + 10, 0]} castShadow>
                  <boxGeometry args={[8, 20, 8]} />
                  <meshStandardMaterial color="#c9a54f" />
                </mesh>
              </group>
            );
          case "fedsquare":
            return (
              <group key={l.id} position={[x, 0, z]}>
                {[[-0.3, 0.2, 0.9], [0.15, -0.15, 1.2], [0.35, 0.25, 0.8]].map(([dx, dz, hf], i) => (
                  <mesh key={i} position={[dx * l.w, (l.height * hf) / 2, dz * l.h]} rotation={[0, i * 0.35, 0]} castShadow>
                    <boxGeometry args={[l.w * 0.4, l.height * hf, l.h * 0.5]} />
                    <meshStandardMaterial color={["#8a7f6a", "#6d6a63", "#a08c62"][i]} roughness={0.9} />
                  </mesh>
                ))}
              </group>
            );
        }
      })}
    </group>
  );
}

function Trees({ world, city }: { world: WorldState; city: CityLayout }) {
  const trunk = useRef<THREE.InstancedMesh>(null);
  const canopy = useRef<THREE.InstancedMesh>(null);
  const n = city.trees.length;
  useEffect(() => {
    const m = new THREE.Object3D();
    const col = new THREE.Color();
    city.trees.forEach((t, i) => {
      const s = t.s;
      m.position.set(toX(world, t.x), 3 * s, toZ(world, t.y));
      m.scale.set(s, s, s);
      m.rotation.set(0, 0, 0);
      m.updateMatrix();
      trunk.current?.setMatrixAt(i, m.matrix);
      m.position.y = 9 * s;
      m.updateMatrix();
      canopy.current?.setMatrixAt(i, m.matrix);
      col.setHSL(0.28 + ((i * 37) % 10) / 100, 0.45, 0.28 + ((i * 13) % 10) / 60);
      canopy.current?.setColorAt(i, col);
    });
    if (trunk.current) trunk.current.instanceMatrix.needsUpdate = true;
    if (canopy.current) {
      canopy.current.instanceMatrix.needsUpdate = true;
      if (canopy.current.instanceColor) canopy.current.instanceColor.needsUpdate = true;
    }
  }, [world, city]);
  return (
    <group>
      <instancedMesh ref={trunk} args={[undefined, undefined, n]} castShadow>
        <cylinderGeometry args={[0.7, 1, 6, 6]} />
        <meshStandardMaterial color="#6b4a2f" />
      </instancedMesh>
      <instancedMesh ref={canopy} args={[undefined, undefined, n]} castShadow>
        <sphereGeometry args={[5.5, 8, 6]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </group>
  );
}

function Lamps({ world, city, day }: { world: WorldState; city: CityLayout; day: Daylight }) {
  const poles = useRef<THREE.InstancedMesh>(null);
  const bulbs = useRef<THREE.InstancedMesh>(null);
  const n = city.lamps.length;
  useEffect(() => {
    const m = new THREE.Object3D();
    city.lamps.forEach((l, i) => {
      m.position.set(toX(world, l.x), 5, toZ(world, l.y));
      m.updateMatrix();
      poles.current?.setMatrixAt(i, m.matrix);
      m.position.y = 10;
      m.updateMatrix();
      bulbs.current?.setMatrixAt(i, m.matrix);
    });
    if (poles.current) poles.current.instanceMatrix.needsUpdate = true;
    if (bulbs.current) bulbs.current.instanceMatrix.needsUpdate = true;
  }, [world, city]);
  const glow = Math.pow(1 - day.daylight, 1.3) * 5;
  return (
    <group>
      <instancedMesh ref={poles} args={[undefined, undefined, n]}>
        <cylinderGeometry args={[0.35, 0.35, 10, 5]} />
        <meshStandardMaterial color="#444" />
      </instancedMesh>
      <instancedMesh ref={bulbs} args={[undefined, undefined, n]}>
        <sphereGeometry args={[0.9, 8, 6]} />
        <meshStandardMaterial color="#ffe9b0" emissive="#ffd27a" emissiveIntensity={glow} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Neon({ world, city, day }: { world: WorldState; city: CityLayout; day: Daylight }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const signs = useMemo(() => city.lots.filter((l) => l.neon), [city]);
  useEffect(() => {
    const m = new THREE.Object3D();
    const col = new THREE.Color();
    signs.forEach((l, i) => {
      m.position.set(toX(world, l.x + l.w / 2), Math.min(l.height - 2, 7), toZ(world, l.y + l.h) + 0.3);
      m.scale.set(Math.min(l.w * 0.6, 14), 2.2, 1);
      m.updateMatrix();
      ref.current?.setMatrixAt(i, m.matrix);
      col.set(l.neon!);
      ref.current?.setColorAt(i, col);
    });
    if (ref.current) {
      ref.current.instanceMatrix.needsUpdate = true;
      if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    }
  }, [world, signs]);
  const on = day.daylight < 0.55;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, signs.length]} visible={on}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

/** A few trams and cars gliding along the grid to make the city feel alive. */
function Traffic({ world, city, day }: { world: WorldState; city: CityLayout; day: Daylight }) {
  const vehicles = useMemo(() => {
    const roads = city.roads;
    const tramRoads = roads.filter((r) => r.tram);
    const pick = (list: typeof roads, i: number) => list[(i * 7) % list.length];
    const out: Array<{ road: (typeof roads)[number]; t: number; speed: number; tram: boolean; color: string }> = [];
    for (let i = 0; i < 4 && tramRoads.length; i++) out.push({ road: pick(tramRoads, i), t: (i * 0.23) % 1, speed: 28, tram: true, color: "#2f7a3e" });
    for (let i = 0; i < 18; i++) out.push({ road: pick(roads, i + 3), t: (i * 0.37) % 1, speed: 45 + (i % 5) * 8, tram: false, color: ["#d64545", "#e8e8e8", "#3b6fd1", "#f2d24b", "#222"][i % 5] });
    return out;
  }, [city]);
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  useFrame((_, dt) => {
    vehicles.forEach((v, i) => {
      const m = refs.current[i];
      if (!m) return;
      const len = v.road.axis === "v" ? v.road.h : v.road.w;
      v.t = (v.t + (dt * v.speed) / len) % 1;
      const along = v.t * len;
      if (v.road.axis === "v") m.position.set(toX(world, v.road.x + v.road.w / 2 + 2), v.tram ? 2.2 : 1.2, toZ(world, v.road.y + along));
      else m.position.set(toX(world, v.road.x + along), v.tram ? 2.2 : 1.2, toZ(world, v.road.y + v.road.h / 2 + 2));
      m.rotation.y = v.road.axis === "v" ? Math.PI / 2 : 0;
    });
  });
  const glow = Math.pow(1 - day.daylight, 1.3) * 2;
  return (
    <group>
      {vehicles.map((v, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} castShadow>
          <boxGeometry args={v.tram ? [16, 4.4, 3.2] : [4.6, 2.2, 2.4]} />
          <meshStandardMaterial color={v.color} emissive={v.tram ? "#9fe0a8" : "#ffe6a0"} emissiveIntensity={glow * (v.tram ? 0.5 : 0.35)} roughness={0.4} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function Entity({
  world,
  e,
  windowTex,
  emphasized,
  day,
  onSelect,
}: {
  world: WorldState;
  e: WorldEntity;
  windowTex: { albedo: THREE.Texture; emissive: THREE.Texture };
  emphasized: boolean;
  day: Daylight;
  onSelect?: (e: WorldEntity | null) => void;
}) {
  const fill = entityFill(e);
  const cx = toX(world, e.x + e.w / 2);
  const cz = toZ(world, e.y + e.h / 2);
  const glow = Math.pow(1 - day.daylight, 1.5);
  const isBuilding = e.kind === "building";
  const buildingGeoms = useMemo(
    () => (isBuilding ? buildBoxes(world, [{ x: e.x, y: e.y, w: e.w, h: e.h, height: e.height, color: fill }]) : null),
    [isBuilding, world, e.x, e.y, e.w, e.h, e.height, fill],
  );
  const handlers = {
    onClick: (ev: { stopPropagation: () => void }) => {
      ev.stopPropagation();
      onSelect?.(e);
    },
  };
  const highlight = emphasized ? (
    <mesh position={[cx, 0.5, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[Math.max(e.w, e.h) * 0.7, Math.max(e.w, e.h) * 0.85, 40]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.9} toneMapped={false} />
    </mesh>
  ) : null;

  switch (e.kind) {
    case "building": {
      const geoms = buildingGeoms!;
      return (
        <group {...handlers}>
          <mesh geometry={geoms.walls} castShadow receiveShadow>
            <meshStandardMaterial map={windowTex.albedo} emissiveMap={windowTex.emissive} emissive="#ffffff" emissiveIntensity={glow * 1.1} vertexColors roughness={0.7} />
          </mesh>
          <mesh geometry={geoms.roofs} castShadow>
            <meshStandardMaterial vertexColors roughness={0.9} />
          </mesh>
          {highlight}
        </group>
      );
    }
    case "vehicle":
      return (
        <group {...handlers} position={[cx, 0, cz]} rotation={[0, (e.rotation * Math.PI) / 180, 0]}>
          <mesh position={[0, 1.3, 0]} castShadow>
            <boxGeometry args={[Math.max(4, e.w * 0.14), 2.2, Math.max(2.2, e.h * 0.12)]} />
            <meshStandardMaterial color={fill} roughness={0.35} metalness={0.4} emissive="#ffe6a0" emissiveIntensity={glow * 0.3} />
          </mesh>
          <mesh position={[0.2, 2.9, 0]} castShadow>
            <boxGeometry args={[Math.max(2, e.w * 0.07), 1.3, Math.max(1.8, e.h * 0.1)]} />
            <meshStandardMaterial color="#222" roughness={0.2} metalness={0.6} />
          </mesh>
          {highlight}
        </group>
      );
    case "tree":
      return (
        <group {...handlers} position={[cx, 0, cz]}>
          <mesh position={[0, 3, 0]} castShadow>
            <cylinderGeometry args={[0.7, 1, 6, 6]} />
            <meshStandardMaterial color="#6b4a2f" />
          </mesh>
          <mesh position={[0, 9, 0]} castShadow>
            <sphereGeometry args={[Math.max(4, e.w * 0.15), 10, 8]} />
            <meshStandardMaterial color={fill} roughness={0.9} />
          </mesh>
          {highlight}
        </group>
      );
    case "character":
    case "animal":
      return (
        <group {...handlers} position={[cx, 0, cz]}>
          <mesh position={[0, 1.6, 0]} castShadow>
            <capsuleGeometry args={[e.kind === "animal" ? 1 : 0.7, e.kind === "animal" ? 1.5 : 2, 4, 8]} />
            <meshStandardMaterial color={fill} roughness={0.8} />
          </mesh>
          {highlight}
        </group>
      );
    case "water":
      return (
        <group {...handlers}>
          <mesh position={[cx, 0.7, cz]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[e.w, e.h]} />
            <meshStandardMaterial color="#3f7fb5" roughness={0.15} metalness={0.6} transparent opacity={0.9} />
          </mesh>
          {highlight}
        </group>
      );
    case "road":
      return (
        <group {...handlers}>
          <mesh position={[cx, 0.4, cz]} rotation={[-Math.PI / 2, (e.rotation * Math.PI) / 180, 0]}>
            <planeGeometry args={[e.w, e.h]} />
            <meshStandardMaterial color="#3d3f42" roughness={0.95} />
          </mesh>
          {highlight}
        </group>
      );
    case "scene":
      return (
        <group {...handlers}>
          <mesh position={[cx, 1, cz]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[Math.max(6, e.w * 0.25), 32]} />
            <meshBasicMaterial color={fill} transparent opacity={0.45} toneMapped={false} />
          </mesh>
          <pointLight position={[cx, 8, cz]} color={fill} intensity={40 + glow * 200} distance={80} decay={2} />
          {highlight}
        </group>
      );
    default: // prop, sign
      return (
        <group {...handlers} position={[cx, 0, cz]}>
          <mesh position={[0, Math.max(1.5, e.height * 0.12) / 2, 0]} castShadow>
            <boxGeometry args={[Math.max(2, e.w * 0.12), Math.max(1.5, e.height * 0.12), Math.max(2, e.h * 0.12)]} />
            <meshStandardMaterial color={fill} roughness={0.7} emissive={e.kind === "sign" ? fill : "#000"} emissiveIntensity={e.kind === "sign" ? glow * 1.5 : 0} />
          </mesh>
          {highlight}
        </group>
      );
  }
}

/** Gradient sky dome — reads far better than a flat clear colour at dawn/dusk. */
function SkyDome({ day }: { day: Daylight }) {
  const pal = palette(day);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color("#ffffff") }, bottom: { value: new THREE.Color("#ffffff") } },
        vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.75)), 1.0); }",
      }),
    [],
  );
  useEffect(() => {
    mat.uniforms.top.value.set(pal.sky);
    mat.uniforms.bottom.value.set(pal.horizon);
  }, [mat, pal.sky, pal.horizon]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} scale={[2600, 2600, 2600]} renderOrder={-1}>
      <sphereGeometry args={[1, 24, 16]} />
    </mesh>
  );
}

/** Rooftop plant: AC units and water tanks on anything tall enough to see them on. */
function RoofClutter({ world, city, takenLots }: { world: WorldState; city: CityLayout; takenLots: Set<string> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: Array<{ x: number; y: number; w: number; d: number; h: number; top: number }> = [];
    let s = 99;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (const lot of city.lots) {
      if (takenLots.has(lot.id) || lot.height < 22) continue;
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const w = Math.min(lot.w * 0.5, 3 + rnd() * 5);
        const d = Math.min(lot.h * 0.5, 3 + rnd() * 5);
        out.push({ x: lot.x + rnd() * Math.max(0.1, lot.w - w), y: lot.y + rnd() * Math.max(0.1, lot.h - d), w, d, h: 1.5 + rnd() * 3.5, top: lot.height });
      }
    }
    return out.slice(0, 1500);
  }, [city, takenLots]);
  useEffect(() => {
    const m = new THREE.Object3D();
    items.forEach((it, i) => {
      m.position.set(toX(world, it.x + it.w / 2), it.top + it.h / 2, toZ(world, it.y + it.d / 2));
      m.scale.set(it.w, it.h, it.d);
      m.updateMatrix();
      ref.current?.setMatrixAt(i, m.matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [world, items]);
  if (!items.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#8b8f93" roughness={0.85} />
    </instancedMesh>
  );
}

/**
 * Camera: initial fit, iso vs straight-down view, and animated flights when
 * someone picks an area. Signals `onReady` once the first frames have drawn so
 * the parent can drop its loading overlay.
 */
function CameraRig({
  world,
  view,
  focus,
  onReady,
}: {
  world: WorldState;
  view: ViewMode;
  focus: { x: number; z: number; key: number } | null;
  onReady?: () => void;
}) {
  const { camera, size, controls } = useThree();
  const fitted = useRef(false);
  const frames = useRef(0);
  const goal = useRef<{ target: THREE.Vector3; zoom: number } | null>(null);

  const baseZoom = useMemo(
    () => Math.min(size.width / (world.width * (view === "top" ? 1.05 : 1.2)), size.height / (world.height * (view === "top" ? 1.05 : 0.78))),
    [size.width, size.height, world.width, world.height, view],
  );

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    const t = ctrl?.target ?? new THREE.Vector3();
    const d = 1200;
    // Keep whatever the camera is centred on when switching views. In bird's-eye
    // the camera sits directly above with a hair of +Z offset, which pins the
    // azimuth at zero so the map reads as a north-up plan rather than a rotated one.
    if (view === "top") cam.position.set(t.x, t.y + d, t.z + 0.0001);
    else cam.position.set(t.x + d * 0.72, t.y + d * 0.62, t.z + d * 0.72);
    if (!fitted.current) {
      cam.zoom = baseZoom;
      fitted.current = true;
    }
    cam.updateProjectionMatrix();
    ctrl?.update();
  }, [camera, controls, view, baseZoom]);

  useEffect(() => {
    if (!focus) return;
    goal.current = { target: new THREE.Vector3(focus.x, 0, focus.z), zoom: baseZoom * 2.4 };
  }, [focus, baseZoom]);

  useFrame(() => {
    frames.current += 1;
    if (frames.current === 4) onReady?.();
    const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!ctrl || !goal.current) return;
    const cam = camera as THREE.OrthographicCamera;
    ctrl.target.lerp(goal.current.target, 0.1);
    cam.zoom += (goal.current.zoom - cam.zoom) * 0.1;
    cam.updateProjectionMatrix();
    ctrl.update();
    if (ctrl.target.distanceTo(goal.current.target) < 1.5 && Math.abs(cam.zoom - goal.current.zoom) < 0.02) goal.current = null;
  });
  return null;
}

function Scene({
  world,
  city,
  day,
  rain,
  selectedId,
  highlightSubmissionId,
  onSelect,
}: {
  world: WorldState;
  city: CityLayout;
  day: Daylight;
  rain: boolean;
  selectedId?: string | null;
  highlightSubmissionId?: string | null;
  onSelect?: (e: WorldEntity | null) => void;
}) {
  const takenLots = useMemo(() => new Set(world.entities.map((e) => (e.meta as EntityMeta).lotId).filter((s): s is string => Boolean(s))), [world.entities]);
  const windowTex = useMemo(() => makeWindowTextures(5), []);
  const night = 1 - day.daylight;
  return (
    <>
      <Lighting day={day} />
      <SkyDome day={day} />
      <Stars day={day} />
      <group onClick={() => onSelect?.(null)}>
        <Ground world={world} city={city} />
        <Water world={world} city={city} day={day} />
      </group>
      <CityBuildings world={world} city={city} takenLots={takenLots} day={day} />
      <RoofClutter world={world} city={city} takenLots={takenLots} />
      <Landmarks world={world} city={city} day={day} />
      <Trees world={world} city={city} />
      <Lamps world={world} city={city} day={day} />
      <Neon world={world} city={city} day={day} />
      <Traffic world={world} city={city} day={day} />
      {world.entities.map((e) => {
        const meta = e.meta as EntityMeta;
        const emphasized = e.id === selectedId || Boolean(highlightSubmissionId && meta.submissionId === highlightSubmissionId);
        return <Entity key={e.id} world={world} e={e} windowTex={windowTex} emphasized={emphasized} day={day} onSelect={onSelect} />;
      })}
      <Rain world={world} enabled={rain} />
      <EffectComposer enableNormalPass={false}>
        <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={0.35 + night * 1.1} mipmapBlur />
      </EffectComposer>
    </>
  );
}

/* ------------------------------- component -------------------------------- */

export function World3D({
  world,
  selectedId,
  onSelect,
  highlightSubmissionId,
  hourOverride = null,
  rain = false,
  view = "iso",
  focusZoneId = null,
  height,
  className,
}: {
  world: WorldState;
  selectedId?: string | null;
  onSelect?: (entity: WorldEntity | null) => void;
  highlightSubmissionId?: string | null;
  /** Local Melbourne hour to render (0..24), or null for the live clock. */
  hourOverride?: number | null;
  rain?: boolean;
  view?: ViewMode;
  /** Set to an area id (plus a nonce) to fly the camera there. */
  focusZoneId?: { id: string; key: number } | null;
  /** CSS height; falls back to a 16:10 box. */
  height?: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const when = hourOverride === null ? now : dateAtLocalHour(hourOverride, now);
  const day = useMemo(() => daylightAt(when), [when]);
  // Memoise on stable keys: the server hands us a fresh zones array on every refresh.
  const zonesKey = JSON.stringify(world.zones ?? []);
  const city = useMemo(
    () => generateCity(world.citySeed ?? "city", JSON.parse(zonesKey), world.width),
    [world.citySeed, zonesKey, world.width],
  );

  const focus = useMemo(() => {
    if (!focusZoneId) return null;
    const zone = (world.zones ?? []).find((z) => z.id === focusZoneId.id);
    if (!zone) return null;
    const c = zoneCenter(zone);
    return { x: toX(world, c.x), z: toZ(world, c.y), key: focusZoneId.key };
  }, [focusZoneId, world]);

  const clock = `${String(Math.floor(day.localHour)).padStart(2, "0")}:${String(Math.floor((day.localHour % 1) * 60)).padStart(2, "0")}`;
  const phase = day.phase === "night" ? "Night" : day.phase === "day" ? "Day" : day.phase === "dawn" ? "Dawn" : "Dusk";

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-900 dark:border-zinc-800 ${className ?? ""}`}
      style={height ? { height } : { aspectRatio: "16 / 10" }}
    >
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.95 }}
        onPointerMissed={() => onSelect?.(null)}
      >
        <OrthographicCamera makeDefault position={[900, 760, 900]} near={-2000} far={5000} zoom={0.5} />
        <CameraRig world={world} view={view} focus={focus} onReady={() => setReady(true)} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enableRotate={view === "iso"}
          minZoom={0.3}
          maxZoom={14}
          minPolarAngle={view === "top" ? 0 : Math.PI * 0.14}
          maxPolarAngle={view === "top" ? 0 : Math.PI * 0.45}
          screenSpacePanning={false}
          target={[0, 0, 0]}
        />
        <Scene world={world} city={city} day={day} rain={rain} selectedId={selectedId} highlightSubmissionId={highlightSubmissionId} onSelect={onSelect} />
      </Canvas>

      {!ready && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950 text-sm text-zinc-300">
          <svg className="h-6 w-6 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Building the city…
        </div>
      )}

      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/45 px-2 py-1 text-[11px] text-white backdrop-blur">
        {phase} · Melbourne {clock}
        {hourOverride !== null ? " · preview" : " · live"}
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 text-[10px] text-white/60">
        {view === "top" ? "wheel to zoom · drag to pan" : "drag to orbit · wheel to zoom · right-drag to pan"}
      </div>
    </div>
  );
}
