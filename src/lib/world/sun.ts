/**
 * Sun position and time-of-day for a real city, so the 3D world's lighting
 * follows the actual sky over Melbourne. Simplified NOAA solar geometry —
 * accurate to well under a degree, which is plenty for lighting.
 */

export const MELBOURNE = { lat: -37.8136, lon: 144.9631, tz: "Australia/Melbourne" } as const;

const RAD = Math.PI / 180;

function toJulian(date: Date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Sun altitude/azimuth (radians) for a location at a UTC instant. Azimuth: 0 = north, clockwise. */
export function sunPosition(date: Date, lat = MELBOURNE.lat, lon = MELBOURNE.lon) {
  const d = toJulian(date) - 2451545.0;
  const g = RAD * ((357.529 + 0.98560028 * d) % 360);
  const q = RAD * ((280.459 + 0.98564736 * d) % 360);
  const L = q + RAD * (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const e = RAD * (23.439 - 0.00000036 * d);
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = RAD * ((280.46061837 + 360.98564736629 * d) % 360);
  const lst = gmst + RAD * lon;
  const ha = lst - ra;
  const phi = RAD * lat;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const azimuth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  return { altitude, azimuth };
}

export type DayPhase = "night" | "dawn" | "day" | "dusk";

export interface Daylight {
  altitude: number;
  azimuth: number;
  /** 0 = deep night, 1 = full day. Smooth through twilight. */
  daylight: number;
  /** 0..1 warmth of the light (golden hour peaks near the horizon). */
  golden: number;
  phase: DayPhase;
  /** Local wall-clock hour in the city, 0..24 fractional. */
  localHour: number;
}

export function daylightAt(date: Date, lat = MELBOURNE.lat, lon = MELBOURNE.lon, tz: string = MELBOURNE.tz): Daylight {
  const { altitude, azimuth } = sunPosition(date, lat, lon);
  const deg = altitude / RAD;
  // Civil twilight spans -6° .. 0°; ease over -8° .. +6° for a soft transition.
  const daylight = clamp01((deg + 8) / 14);
  const golden = clamp01(1 - Math.abs(deg - 2) / 12);
  const phase: DayPhase = deg < -8 ? "night" : deg < 4 ? (isMorning(date, tz) ? "dawn" : "dusk") : "day";
  return { altitude, azimuth, daylight, golden, phase, localHour: localHour(date, tz) };
}

export function localHour(date: Date, tz: string = MELBOURNE.tz): number {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") + get("minute") / 60 + get("second") / 3600;
}

function isMorning(date: Date, tz: string) {
  return localHour(date, tz) < 12;
}

/** A Date for "today in the city at this local hour" — for the time scrubber. */
export function dateAtLocalHour(hour: number, ref = new Date(), tz: string = MELBOURNE.tz): Date {
  const nowLocal = localHour(ref, tz);
  const deltaHours = hour - nowLocal;
  return new Date(ref.getTime() + deltaHours * 3600000);
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/** Lerp two hex colors. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Sky, sun and ambient colours for a daylight state. */
export function palette(d: Daylight) {
  const night = { sky: "#0a0f22", horizon: "#182038", sun: "#334466", ambient: "#1c2340", fog: "#0c1224" };
  const twilight = { sky: "#3b4a7a", horizon: "#e08a5a", sun: "#ffb070", ambient: "#6a6f94", fog: "#5b5f86" };
  const day = { sky: "#9ecbf0", horizon: "#dbeaf5", sun: "#fff4e0", ambient: "#b7c8dc", fog: "#c5d6e6" };
  const t = d.daylight;
  const pick = (k: keyof typeof day) => (t < 0.5 ? mixHex(night[k], twilight[k], t * 2) : mixHex(twilight[k], day[k], (t - 0.5) * 2));
  return { sky: pick("sky"), horizon: pick("horizon"), sun: pick("sun"), ambient: pick("ambient"), fog: pick("fog") };
}
