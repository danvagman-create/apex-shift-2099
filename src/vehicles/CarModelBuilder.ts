import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/utils';
import type { BodyStation, VehicleStyle } from './VehicleSpecs';

/**
 * Procedural car body generator.
 * The body is a loft of cross-sections along the car (t: 0 nose .. 1 tail). Each half
 * cross-section is built from four pieces: lower body, upper body/fender, deck (hood with
 * a valley between fenders) and cabin (greenhouse). Wheel arches are carved by lifting
 * side vertices onto arch circles. Car local axes: +Z forward, +Y up, +X left.
 */

const KEYS: (keyof BodyStation)[] = ['w', 'mid', 'bot', 'sh', 'x0', 'cw', 'top', 'dip'];

/** Monotone cubic (Fritsch–Carlson) interpolation of station parameters. */
export function interpStation(stations: BodyStation[], t: number): BodyStation {
  const n = stations.length;
  t = clamp(t, stations[0].t, stations[n - 1].t);
  let i = 0;
  while (i < n - 2 && stations[i + 1].t < t) i++;
  const a = stations[i];
  const b = stations[i + 1];
  const h = b.t - a.t;
  const u = h > 0 ? (t - a.t) / h : 0;
  const out = { t } as BodyStation;
  for (const k of KEYS) {
    const y0 = a[k] as number;
    const y1 = b[k] as number;
    const slope = (j: number) => {
      const p = stations[Math.max(0, j - 1)];
      const q = stations[Math.min(n - 1, j + 1)];
      const s0 = (y(j) - (p[k] as number)) / Math.max(1e-6, stations[j].t - p.t);
      const s1 = ((q[k] as number) - y(j)) / Math.max(1e-6, q.t - stations[j].t);
      if (j === 0) return s1;
      if (j === n - 1) return s0;
      if (s0 * s1 <= 0) return 0;
      return (2 * s0 * s1) / (s0 + s1);
    };
    const y = (j: number) => stations[j][k] as number;
    const m0 = slope(i) * h;
    const m1 = slope(i + 1) * h;
    const u2 = u * u;
    const u3 = u2 * u;
    (out as unknown as Record<string, number>)[k] =
      (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * m1;
  }
  return out;
}

const superCos = (a: number, n: number) => Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 2 / n);
const superSin = (a: number, n: number) => Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 2 / n);

export interface ProfileCounts {
  p1: number;
  p2: number;
  p3: number;
  p4: number;
}

export const HIGH_COUNTS: ProfileCounts = { p1: 10, p2: 10, p3: 5, p4: 12 };
export const LOW_COUNTS: ProfileCounts = { p1: 5, p2: 5, p3: 2, p4: 6 };

export const PIECE_U = [0, 0.27, 0.54, 0.68, 1];

/** Half profile point at parameter u (0 bottom center .. 1 roof center), x >= 0. */
export function profilePoint(st: BodyStation, style: VehicleStyle, u: number, out = new THREE.Vector2()): THREE.Vector2 {
  const cw = Math.max(0, st.cw);
  const x0 = Math.max(st.x0, cw + 0.03);
  const shBase = st.sh - st.dip;
  const cabinH = Math.max(0, st.top - shBase) * smoothstep(0.0, 0.12, cw);
  if (u <= PIECE_U[1]) {
    const f = u / PIECE_U[1];
    const phi = -Math.PI / 2 + f * (Math.PI / 2);
    out.set(st.w * Math.abs(superCos(phi, style.nb)), st.mid - (st.mid - st.bot) * Math.abs(superSin(phi, style.nb)));
  } else if (u <= PIECE_U[2]) {
    const f = (u - PIECE_U[1]) / (PIECE_U[2] - PIECE_U[1]);
    const phi = f * (Math.PI / 2);
    out.set(x0 + (st.w - x0) * Math.abs(superCos(phi, style.nu)), st.mid + (st.sh - st.mid) * Math.abs(superSin(phi, style.nu)));
  } else if (u <= PIECE_U[3]) {
    const f = (u - PIECE_U[2]) / (PIECE_U[3] - PIECE_U[2]);
    out.set(lerp(x0, cw, f), st.sh - st.dip * smoothstep(0, 1, f));
  } else {
    const f = (u - PIECE_U[3]) / (PIECE_U[4] - PIECE_U[3]);
    const phi = f * (Math.PI / 2);
    out.set(cw * Math.abs(superCos(phi, style.nc)), shBase + cabinH * Math.abs(superSin(phi, style.nc)));
  }
  return out;
}

function profileUs(c: ProfileCounts): number[] {
  const us: number[] = [];
  const pieces = [c.p1, c.p2, c.p3, c.p4];
  for (let p = 0; p < 4; p++) {
    const a = PIECE_U[p];
    const b = PIECE_U[p + 1];
    for (let i = 0; i < pieces[p]; i++) us.push(a + ((b - a) * i) / pieces[p]);
  }
  us.push(1);
  return us;
}

/** Station t values: denser at nose and tail. */
function stationTs(count: number): number[] {
  const ts: number[] = [];
  for (let i = 0; i <= count; i++) {
    const f = i / count;
    // ease so ends get more samples
    ts.push(0.5 - 0.5 * Math.cos(f * Math.PI) * 0.82 - (0.5 - f) * 0.18);
  }
  ts[0] = 0;
  ts[count] = 1;
  return ts;
}

export const zAt = (style: VehicleStyle, t: number) => style.length / 2 - t * style.length;

/** Evaluate surface point & normal (analytic body, no arch deformation). */
export function surfacePoint(style: VehicleStyle, t: number, u: number, side: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
  const st = interpStation(style.stations, t);
  const p = profilePoint(st, style, clamp(u, 0, 1));
  return out.set(p.x * side, p.y, zAt(style, t));
}

export function surfaceNormal(style: VehicleStyle, t: number, u: number, side: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.003;
  const p0 = surfacePoint(style, t, u, side, new THREE.Vector3());
  const pt = surfacePoint(style, Math.min(1, t + e), u, side, new THREE.Vector3()).sub(p0);
  const pu = surfacePoint(style, t, Math.min(1, u + e), side, new THREE.Vector3()).sub(p0);
  out.crossVectors(pt, pu).multiplyScalar(side).normalize();
  if (out.lengthSq() < 0.5) out.set(side, 0, 0);
  return out;
}

export const GROUP_PAINT = 0;
export const GROUP_GLASS = 1;
export const GROUP_UNDER = 2;
export const GROUP_TAIL = 3;

export function buildBodyGeometry(style: VehicleStyle, lod: 'high' | 'low'): THREE.BufferGeometry {
  const counts = lod === 'high' ? HIGH_COUNTS : LOW_COUNTS;
  const us = profileUs(counts);
  const H = us.length; // half ring point count
  const ringCount = H * 2 - 1;
  const ts = stationTs(lod === 'high' ? 96 : 40);
  const S = ts.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const p2 = new THREE.Vector2();
  const wheelR = style.wheelRadius;
  const arches = [zAt(style, style.frontAxleT), zAt(style, style.rearAxleT)];
  const Ra = wheelR + 0.07;
  const innerX = style.trackHalf - style.tireWidth / 2 - 0.05;
  const cabinU0 = PIECE_U[3];

  for (let si = 0; si < S; si++) {
    const t = ts[si];
    const st = interpStation(style.stations, t);
    const z = zAt(style, t);
    // nose rounding: shrink first few cm
    const nose = t < 0.02 ? Math.sqrt(Math.max(0.0, 1 - Math.pow(1 - t / 0.02, 2))) * 0.6 + 0.4 : 1;
    for (let r = 0; r < ringCount; r++) {
      const hIdx = r < H ? r : ringCount - 1 - r;
      const side = r < H ? 1 : -1;
      const u = us[hIdx];
      profilePoint(st, style, u, p2);
      let x = p2.x * side * nose;
      let y = lerp((st.mid + st.bot) / 2, p2.y, nose);
      // wheel arches (only lower/upper body pieces)
      if (u < PIECE_U[2] + 0.001) {
        for (const za of arches) {
          const dz = z - za;
          if (Math.abs(dz) < Ra) {
            const archY = wheelR + Math.sqrt(Ra * Ra - dz * dz);
            const b = smoothstep(innerX - 0.14, innerX, Math.abs(x));
            if (y < archY && b > 0) y = lerp(y, archY, b);
          }
        }
      }
      pos.push(x, y, z);
      uv.push(r / (ringCount - 1), t);
    }
  }
  // caps: front centroid and tail centroid
  const frontCenter = pos.length / 3;
  {
    const st = interpStation(style.stations, 0);
    pos.push(0, (st.mid + st.bot) / 2 + 0.02, zAt(style, 0) + 0.035);
    uv.push(0.5, 0);
  }
  const tailCenter = pos.length / 3;
  {
    const st = interpStation(style.stations, 1);
    pos.push(0, (st.mid + st.bot) / 2 + 0.05, zAt(style, 1) - 0.01);
    uv.push(0.5, 1);
  }

  const groups: number[][] = [[], [], [], []];
  const P = (si: number, r: number) => si * ringCount + r;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const [g0, g1] = style.glass;
  const roofA = g0 + (g1 - g0) * 0.32;
  const roofB = g1 - (g1 - g0) * 0.12;
  for (let si = 0; si < S - 1; si++) {
    const tm = (ts[si] + ts[si + 1]) / 2;
    const st = interpStation(style.stations, tm);
    for (let r = 0; r < ringCount - 1; r++) {
      const a = P(si, r);
      const b = P(si, r + 1);
      const c = P(si + 1, r);
      const d = P(si + 1, r + 1);
      // classify quad
      const hIdx = r < H - 1 ? r : ringCount - 2 - r;
      const uA = us[hIdx];
      const uB = us[Math.min(H - 1, hIdx + 1)];
      const um = (uA + uB) / 2;
      let g = GROUP_PAINT;
      tmpA.fromArray(pos, a * 3);
      tmpB.fromArray(pos, b * 3);
      tmpC.fromArray(pos, c * 3);
      const ny = tmpB.sub(tmpA).cross(tmpC.sub(tmpA)).normalize().y * (r < H - 1 ? 1 : -1);
      const yAvg = (pos[a * 3 + 1] + pos[d * 3 + 1]) / 2;
      if (um < PIECE_U[1] * 0.3) g = GROUP_UNDER;
      else if (um < PIECE_U[2] && ny < -0.25 && yAvg < st.mid) g = GROUP_UNDER;
      else if (um > cabinU0 && tm > g0 && tm < g1 && st.cw > 0.12) {
        const topSeg = um > 0.9;
        const isRoof = topSeg && tm > roofA && tm < roofB;
        g = isRoof ? GROUP_PAINT : GROUP_GLASS;
      }
      groups[g].push(a, c, b, b, c, d);
    }
  }
  // front cap (paint) and tail cap (tail panel)
  for (let r = 0; r < ringCount - 1; r++) {
    groups[GROUP_PAINT].push(frontCenter, P(0, r), P(0, r + 1));
    groups[GROUP_TAIL].push(tailCenter, P(S - 1, r + 1), P(S - 1, r));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const index: number[] = [];
  let start = 0;
  for (let g = 0; g < groups.length; g++) {
    index.push(...groups[g]);
    geo.addGroup(start, groups[g].length, g);
    start += groups[g].length;
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Tail cap should look flat: recompute its normals pointing backwards.
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  nrm.setXYZ(tailCenter, 0, 0, -1);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Ribbon strip that follows the body surface along a path in (t, u) space.
 * Used for LED light strips, character lines and decals.
 */
export function surfaceRibbon(
  style: VehicleStyle,
  path: [number, number][],
  side: 1 | -1,
  width: number,
  offset = 0.006,
  segments = 24,
): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const nrms: THREE.Vector3[] = [];
  // resample along the polyline in (t,u)
  const lens: number[] = [0];
  for (let i = 1; i < path.length; i++) lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = lens[lens.length - 1] || 1;
  for (let k = 0; k <= segments; k++) {
    const d = (k / segments) * total;
    let j = 0;
    while (j < path.length - 2 && lens[j + 1] < d) j++;
    const f = (d - lens[j]) / Math.max(1e-6, lens[j + 1] - lens[j]);
    const t = lerp(path[j][0], path[j + 1][0], f);
    const u = lerp(path[j][1], path[j + 1][1], f);
    const p = surfacePoint(style, t, u, side);
    const n = surfaceNormal(style, t, u, side);
    pts.push(p.addScaledVector(n, offset));
    nrms.push(n);
  }
  const pos: number[] = [];
  const idx: number[] = [];
  const tan = new THREE.Vector3();
  const bin = new THREE.Vector3();
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(pts.length - 1, k + 1)];
    tan.subVectors(b, a).normalize();
    bin.crossVectors(nrms[k], tan).normalize().multiplyScalar(width / 2);
    pos.push(pts[k].x + bin.x, pts[k].y + bin.y, pts[k].z + bin.z);
    pos.push(pts[k].x - bin.x, pts[k].y - bin.y, pts[k].z - bin.z);
    if (k > 0) {
      const i0 = (k - 1) * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Airfoil shape (chord along +Z, thickness along Y), centered on the quarter chord. */
export function airfoilShape(chord: number, thick: number): THREE.Shape {
  const s = new THREE.Shape();
  const N = 14;
  const top: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    top.push([x, yt]);
  }
  // camber (inverted wing: generates downforce)
  const camber = (x: number) => -0.04 * Math.sin(Math.PI * x);
  s.moveTo(-0.25 * chord, 0);
  for (const [x, yt] of top) s.lineTo((0.25 - x) * chord, (camber(x) + yt) * chord);
  for (let i = top.length - 1; i >= 0; i--) {
    const [x, yt] = top[i];
    s.lineTo((0.25 - x) * chord, (camber(x) - yt) * chord);
  }
  return s;
}

/** Extruded airfoil spanning X from -span/2..span/2 (chord along Z). */
export function wingGeometry(span: number, chord: number, thick = 0.12): THREE.BufferGeometry {
  const shape = airfoilShape(chord, thick);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, steps: 1, curveSegments: 4 });
  // Shape lies in XY with extrusion along +Z; rotate so chord -> Z, span -> X
  g.rotateY(Math.PI / 2);
  g.translate(-span / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Tire: lathe of rounded rectangle profile, axle along X. */
export function tireGeometry(radius: number, width: number, lod: 'high' | 'low'): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const rimR = radius * 0.7;
  const hw = width / 2;
  const corner = Math.min(0.05, hw * 0.4);
  const cs = lod === 'high' ? 4 : 2;
  pts.push(new THREE.Vector2(rimR, -hw * 0.92));
  for (let i = 0; i <= cs; i++) {
    const a = -Math.PI / 2 + (i / cs) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - corner + Math.cos(a) * corner, -hw + corner + Math.sin(a) * corner));
  }
  for (let i = 0; i <= cs; i++) {
    const a = (i / cs) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - corner + Math.cos(a) * corner, hw - corner + Math.sin(a) * corner));
  }
  pts.push(new THREE.Vector2(rimR, hw * 0.92));
  const g = new THREE.LatheGeometry(pts, lod === 'high' ? 40 : 16);
  // Lathe revolves around Y; rotate so axle is X.
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Rim face with spokes (outer face at +X). */
export function rimGeometry(radius: number, width: number, style: string, lod: 'high' | 'low'): THREE.BufferGeometry {
  const rimR = radius * 0.7;
  const parts: THREE.BufferGeometry[] = [];
  // barrel
  const barrel = new THREE.CylinderGeometry(rimR, rimR, width * 0.85, lod === 'high' ? 32 : 12, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);
  const face = new THREE.Shape();
  face.absarc(0, 0, rimR * 0.98, 0, Math.PI * 2, false);
  const spokes = style === 'mesh' ? 12 : style === 'split' ? 10 : style === 'turbine' ? 14 : style === 'disc' ? 0 : 5;
  if (spokes > 0) {
    const holeR0 = rimR * 0.3;
    const holeR1 = rimR * 0.88;
    const gapAng = (Math.PI * 2) / spokes;
    const spokeFrac = style === 'blade' ? 0.36 : style === 'turbine' ? 0.42 : 0.3;
    for (let i = 0; i < spokes; i++) {
      const a0 = i * gapAng + gapAng * spokeFrac * 0.5;
      const a1 = (i + 1) * gapAng - gapAng * spokeFrac * 0.5;
      const twist = style === 'turbine' || style === 'blade' ? 0.35 : 0;
      const hole = new THREE.Path();
      hole.moveTo(Math.cos(a0) * holeR0, Math.sin(a0) * holeR0);
      hole.lineTo(Math.cos(a0 + twist) * holeR1, Math.sin(a0 + twist) * holeR1);
      hole.absarc(0, 0, holeR1, a0 + twist, a1 + twist, false);
      hole.lineTo(Math.cos(a1) * holeR0, Math.sin(a1) * holeR0);
      hole.absarc(0, 0, holeR0, a1, a0, true);
      face.holes.push(hole);
    }
  }
  const faceGeo = new THREE.ExtrudeGeometry(face, {
    depth: 0.035,
    bevelEnabled: lod === 'high',
    bevelThickness: 0.008,
    bevelSize: 0.006,
    bevelSegments: 1,
    curveSegments: lod === 'high' ? 20 : 8,
  });
  faceGeo.rotateY(Math.PI / 2); // extrusion along +X
  faceGeo.translate(width * 0.36, 0, 0);
  parts.push(faceGeo);
  const cap = new THREE.CylinderGeometry(rimR * 0.2, rimR * 0.24, 0.05, 12);
  cap.rotateZ(-Math.PI / 2);
  cap.translate(width * 0.42, 0, 0);
  parts.push(cap);
  return mergeGeos(parts);
}

/** Minimal geometry merge (positions, normals, uvs) without groups. */
export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  let offset = 0;
  for (let g of geos) {
    if (!g.index) g = g;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      else nrm.push(0, 1, 0);
      if (u) uvs.push(u.getX(i), u.getY(i));
      else uvs.push(0, 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + offset);
    else for (let i = 0; i < p.count; i++) idx.push(i + offset);
    offset += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
