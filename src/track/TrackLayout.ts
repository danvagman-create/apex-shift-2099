import { Vector3 } from 'three';
import { DEG, smootherstep, smoothstep, clamp } from '../core/utils';

/** Bit flags stored per track sample. */
export const F_TUNNEL = 1;
export const F_BRIDGE = 2;
export const F_HOVERLANE = 4;
export const F_JUMP = 8;
export const F_ELEVATED = 16;
export const F_CHASM = 32;
export const F_CANAL = 64;
export const F_NOSCENERY = 128;
export const F_SPIRAL = 256;
export const F_DANGER = 512;

export const TAG_FLAGS: Record<string, number> = {
  tunnel: F_TUNNEL,
  bridge: F_BRIDGE,
  hoverLane: F_HOVERLANE,
  jump: F_JUMP,
  elevated: F_ELEVATED,
  chasm: F_CHASM,
  canal: F_CANAL,
  clear: F_NOSCENERY,
  spiral: F_SPIRAL,
  danger: F_DANGER,
};

/** One layout command: a straight (len) or an arc (turn + radius). Positive turn = left. */
export interface LayoutCmd {
  len?: number;
  turn?: number;
  radius?: number;
  rise?: number;
  dip?: number;
  jump?: number;
  width?: number;
  bankScale?: number;
  tags?: string[];
  hoverLane?: number; // lateral side of hover lane: -1 left, 0 center, 1 right
}

export interface LayoutPoint {
  pos: Vector3;
  d: number;
  cmd: number;
}

export interface LayoutResult {
  points: LayoutPoint[];
  totalDistance: number;
  closureError: number;
  headingError: number;
  cmdStart: number[]; // turtle distance at start of each command
  cmdEnd: number[];
}

const STEP = 4;

/** Walk the commands like a turtle and produce raw points (closed loop corrected). */
export function runLayout(cmds: LayoutCmd[], startHeight: number, startHeading = 0): LayoutResult {
  const points: LayoutPoint[] = [];
  let x = 0;
  let z = 0;
  let h = startHeading * DEG;
  let y = startHeight;
  let d = 0;
  const cmdStart: number[] = [];
  const cmdEnd: number[] = [];
  points.push({ pos: new Vector3(x, y, z), d: 0, cmd: 0 });

  cmds.forEach((c, ci) => {
    const isArc = c.turn !== undefined && c.turn !== 0;
    const length = isArc ? Math.abs(c.turn! * DEG) * (c.radius ?? 100) : c.len ?? 100;
    const steps = Math.max(1, Math.round(length / STEP));
    const ds = length / steps;
    const dh = isArc ? (c.turn! * DEG) / steps : 0;
    const y0 = y;
    const rise = c.rise ?? 0;
    cmdStart.push(d);
    for (let i = 1; i <= steps; i++) {
      // midpoint integration of heading
      const hm = h + dh * 0.5;
      x += Math.sin(hm) * ds;
      z += Math.cos(hm) * ds;
      h += dh;
      d += ds;
      const u = i / steps;
      let yy = y0 + rise * smootherstep(u);
      if (c.dip) yy += c.dip * Math.pow(Math.sin(Math.PI * u), 2);
      if (c.jump) yy += c.jump * jumpProfile(u);
      points.push({ pos: new Vector3(x, yy, z), d, cmd: ci });
    }
    y = y0 + rise;
    cmdEnd.push(d);
  });

  // Closure correction (spread positional error along the loop).
  const first = points[0].pos;
  const last = points[points.length - 1].pos;
  const err = last.clone().sub(first);
  const total = d;
  for (const p of points) {
    const f = p.d / total;
    p.pos.addScaledVector(err, -f);
  }
  points.pop(); // last == first now
  const headingError = ((h - startHeading * DEG) / DEG) % 360;
  return {
    points,
    totalDistance: total,
    closureError: Math.hypot(err.x, err.z),
    headingError: Math.abs(headingError) > 180 ? 360 - Math.abs(headingError) : Math.abs(headingError),
    cmdStart,
    cmdEnd,
  };
}

/**
 * Jump ramp elevation profile over a straight, normalized: rises to 1 then drops sharply.
 * Returns relative height (0..1).
 */
export function jumpProfile(u: number): number {
  if (u < 0.2) return 0;
  if (u < 0.46) return smoothstep(0.2, 0.46, u) * 0.6 + ((u - 0.2) / 0.26) * 0.4;
  if (u < 0.52) return 1 - smoothstep(0.46, 0.52, u) * 1.35;
  if (u < 0.8) return -0.35 * (1 - smoothstep(0.52, 0.8, u));
  return 0;
}

/** Look up which command a turtle distance falls in. */
export function cmdAtDistance(res: LayoutResult, d: number): number {
  const n = res.cmdStart.length;
  let lo = 0;
  let hi = n - 1;
  d = clamp(d, 0, res.totalDistance);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (res.cmdStart[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** End position (x,z) of the raw turtle walk and the heading at each command start. */
function rawWalk(cmds: LayoutCmd[], startHeading: number): { x: number; z: number; headings: number[] } {
  let x = 0;
  let z = 0;
  let h = startHeading * DEG;
  const headings: number[] = [];
  for (const c of cmds) {
    headings.push(h);
    const isArc = c.turn !== undefined && c.turn !== 0;
    if (isArc) {
      const r = c.radius ?? 100;
      const steps = Math.max(1, Math.round((Math.abs(c.turn! * DEG) * r) / STEP));
      const dh = (c.turn! * DEG) / steps;
      const ds = (Math.abs(c.turn! * DEG) * r) / steps;
      for (let i = 0; i < steps; i++) {
        const hm = h + dh * 0.5;
        x += Math.sin(hm) * ds;
        z += Math.cos(hm) * ds;
        h += dh;
      }
    } else {
      const len = c.len ?? 100;
      x += Math.sin(h) * len;
      z += Math.cos(h) * len;
    }
  }
  return { x, z, headings };
}

/**
 * Adjust the lengths of two straight commands so the loop closes exactly.
 * Returns a new command array (inputs untouched).
 */
export function autoClose(cmds: LayoutCmd[], a: number, b: number, startHeading = 0): LayoutCmd[] {
  const out = cmds.map((c) => ({ ...c }));
  const w = rawWalk(out, startHeading);
  const ha = w.headings[a];
  const hb = w.headings[b];
  const ax = Math.sin(ha);
  const az = Math.cos(ha);
  const bx = Math.sin(hb);
  const bz = Math.cos(hb);
  const det = ax * bz - bx * az;
  if (Math.abs(det) < 0.15) throw new Error(`autoClose: commands ${a} and ${b} are nearly parallel`);
  const ex = w.x;
  const ez = w.z;
  const dA = (-ex * bz + bx * ez) / det;
  const dB = (-ax * ez + az * ex) / det;
  out[a].len = (out[a].len ?? 0) + dA;
  out[b].len = (out[b].len ?? 0) + dB;
  return out;
}
