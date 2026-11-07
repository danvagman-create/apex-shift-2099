import { CatmullRomCurve3, Vector3 } from 'three';
import { clamp, lerp, mod, smoothstep } from '../core/utils';
import { runLayout, autoClose, cmdAtDistance, TAG_FLAGS, type LayoutCmd, type LayoutResult } from './TrackLayout';

export interface BranchDef {
  id: string;
  /** Branch leaves the main road at the start of this command (+ fromOffset meters). */
  fromCmd: number;
  fromOffset?: number;
  /** Branch rejoins at the end of this command (- toOffset meters). */
  toCmd: number;
  toOffset?: number;
  /** Side of the main road it leaves from: 1 = right, -1 = left. */
  side: 1 | -1;
  width: number;
  hoverOnly: boolean;
  /** Extra elevation hump in the middle of the branch (meters). */
  rise?: number;
  /** Lateral bulge of the branch path (meters, + = right of chord). */
  bulge?: number;
}

export type TrackTheme = 'tokyo' | 'canyon' | 'skyline';

export interface TrackDef {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  theme: TrackTheme;
  laps: number;
  baseHeight: number;
  defaultWidth: number;
  wallHeight: number;
  bankK: number;
  maxBank: number;
  cmds: LayoutCmd[];
  /** Two straight command indices whose lengths are solved so the loop closes exactly. */
  closeWith?: [number, number];
  branches: BranchDef[];
  /** Minimap rotation (radians) so the layout reads nicely. */
  mapRotation?: number;
  timeTrialTargets: [number, number, number]; // gold, silver, bronze lap times (s)
}

export const SAMPLE_SPACING = 2;

export class TrackSample {
  s = 0;
  pos = new Vector3();
  tangent = new Vector3(0, 0, 1);
  up = new Vector3(0, 1, 0);
  right = new Vector3(-1, 0, 0);
  width = 18;
  bank = 0;
  curvature = 0;
  vCurv = 0;
  flags = 0;
  hoverLane = NaN;
  cmd = 0;
}

export class TrackProjection {
  index = 0;
  t = 0;
  s = 0;
  lateral = 0;
  height = 0;
  pos = new Vector3();
  tangent = new Vector3();
  up = new Vector3();
  right = new Vector3();
  width = 0;
  flags = 0;
  vCurv = 0;
  curvature = 0;
  hoverLane = NaN;
  wallL = true;
  wallR = true;
  connL = -1;
  connR = -1;
  /** Signed distance (m) past the end of an open path; 0 when inside. */
  overrun = 0;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

export class TrackPath {
  samples: TrackSample[] = [];
  length = 0;
  spacing = SAMPLE_SPACING;
  wallL!: Uint8Array;
  wallR!: Uint8Array;
  connL!: Int16Array;
  connR!: Int16Array;
  hoverOnly = false;
  /** For branches: main-track s at entry/exit and side. */
  entryS = 0;
  exitS = 0;
  side: 1 | -1 = 1;
  id = 'main';

  constructor(
    public readonly index: number,
    public readonly closed: boolean,
  ) {}

  get count(): number {
    return this.samples.length;
  }

  /** Build samples from control points. */
  static fromPoints(index: number, pts: Vector3[], closed: boolean, spacing = SAMPLE_SPACING): TrackPath {
    const path = new TrackPath(index, closed);
    const curve = new CatmullRomCurve3(pts, closed, 'centripetal', 0.5);
    const approxLen = curve.getLength();
    curve.arcLengthDivisions = Math.max(200, Math.ceil(approxLen / 0.5));
    curve.updateArcLengths();
    const length = curve.getLength();
    const n = Math.max(8, Math.round(length / spacing));
    const spaced = curve.getSpacedPoints(n);
    path.length = length;
    path.spacing = length / n;
    const count = closed ? n : n + 1;
    for (let i = 0; i < count; i++) {
      const smp = new TrackSample();
      smp.s = i * path.spacing;
      smp.pos.copy(spaced[i]);
      path.samples.push(smp);
    }
    path.wallL = new Uint8Array(count).fill(1);
    path.wallR = new Uint8Array(count).fill(1);
    path.connL = new Int16Array(count).fill(-1);
    path.connR = new Int16Array(count).fill(-1);
    path.computeTangents();
    return path;
  }

  wrapIndex(i: number): number {
    const n = this.samples.length;
    return this.closed ? mod(i, n) : clamp(i, 0, n - 1);
  }

  computeTangents(): void {
    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const prev = this.samples[this.wrapIndex(i - 1)].pos;
      const next = this.samples[this.wrapIndex(i + 1)].pos;
      this.samples[i].tangent.subVectors(next, prev).normalize();
    }
  }

  /** Signed horizontal curvature (+ = left turn) and vertical curvature (+ = crest). */
  computeCurvature(smoothWindow = 6): void {
    const n = this.samples.length;
    const raw = new Float32Array(n);
    const vraw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const tp = this.samples[this.wrapIndex(i - 1)].tangent;
      const tn = this.samples[this.wrapIndex(i + 1)].tangent;
      const hp = Math.atan2(tp.x, tp.z);
      let dh = Math.atan2(tn.x, tn.z) - hp;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      raw[i] = dh / (2 * this.spacing);
      const pp = Math.asin(clamp(tp.y, -1, 1));
      const pn = Math.asin(clamp(tn.y, -1, 1));
      vraw[i] = -(pn - pp) / (2 * this.spacing);
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let cnt = 0;
      for (let k = -smoothWindow; k <= smoothWindow; k++) {
        const j = this.closed ? mod(i + k, n) : i + k;
        if (j < 0 || j >= n) continue;
        sum += raw[j];
        cnt++;
      }
      this.samples[i].curvature = sum / cnt;
      let vs = 0;
      let vc = 0;
      for (let k = -1; k <= 1; k++) {
        const j = this.closed ? mod(i + k, n) : i + k;
        if (j < 0 || j >= n) continue;
        vs += vraw[j];
        vc++;
      }
      this.samples[i].vCurv = vs / vc;
    }
  }

  /** Compute up/right frames from bank angles already stored on samples. */
  computeFrames(): void {
    for (const smp of this.samples) {
      const T = smp.tangent;
      const u0 = _a.copy(WORLD_UP).addScaledVector(T, -T.dot(WORLD_UP)).normalize();
      const r0 = _b.crossVectors(T, u0).normalize();
      const cb = Math.cos(smp.bank);
      const sb = Math.sin(smp.bank);
      smp.up.copy(u0).multiplyScalar(cb).addScaledVector(r0, sb).normalize();
      smp.right.crossVectors(T, smp.up).normalize();
    }
  }

  /** Project a world point onto the path. hint < 0 = global search. */
  project(p: Vector3, hint: number, out: TrackProjection, window = 24): TrackProjection {
    const n = this.samples.length;
    let best = 0;
    let bestD = Infinity;
    // Vertical distance is weighted only for global searches (to disambiguate stacked roads).
    const wy = hint < 0 || hint >= n ? 2.5 : 1;
    const test = (i: number) => {
      const q = this.samples[i].pos;
      const dx = p.x - q.x;
      const dy = (p.y - q.y) * wy;
      const dz = p.z - q.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    };
    if (hint < 0 || hint >= n) {
      for (let i = 0; i < n; i++) test(i);
    } else {
      for (let k = -window; k <= window; k++) {
        const i = this.closed ? mod(hint + k, n) : hint + k;
        if (i < 0 || i >= n) continue;
        test(i);
      }
    }
    // Walk along sample tangent planes so the segment brackets the point exactly,
    // which stays correct for large lateral offsets on banked / sloped roads.
    let segA = best;
    for (let iter = 0; iter < 16; iter++) {
      const next = segA + 1;
      if (this.closed || next < n) {
        const ni = this.closed ? mod(next, n) : next;
        const sn = this.samples[ni];
        if (_b.subVectors(p, sn.pos).dot(sn.tangent) > 0 && (this.closed || ni < n - 1)) {
          segA = ni;
          continue;
        }
      }
      const sa = this.samples[segA];
      if (_b.subVectors(p, sa.pos).dot(sa.tangent) < 0 && (this.closed || segA > 0)) {
        segA = this.closed ? mod(segA - 1, n) : segA - 1;
        continue;
      }
      break;
    }
    if (!this.closed) segA = clamp(segA, 0, n - 2);
    const segB = this.closed ? mod(segA + 1, n) : segA + 1;
    const pa = this.samples[segA].pos;
    _a.subVectors(this.samples[segB].pos, pa);
    const len2 = _a.lengthSq();
    // Plane-based parameter: fraction between the two tangent planes.
    const da = _b.subVectors(p, pa).dot(this.samples[segA].tangent);
    const db = _c.subVectors(p, this.samples[segB].pos).dot(this.samples[segB].tangent);
    let t = da - db > 1e-6 ? da / (da - db) : len2 > 1e-9 ? _b.dot(_a) / len2 : 0;
    t = clamp(t, 0, 1);
    this.fillFrame(segA, t, out);
    // Overrun for open paths (beyond ends).
    out.overrun = 0;
    if (!this.closed) {
      if (segA === 0 && t === 0) {
        out.overrun = -_b.subVectors(p, this.samples[0].pos).dot(this.samples[0].tangent);
      } else if (segA === n - 2 && t === 1) {
        out.overrun = _b.subVectors(p, this.samples[n - 1].pos).dot(this.samples[n - 1].tangent);
      }
    }
    _a.subVectors(p, out.pos);
    out.lateral = _a.dot(out.right);
    out.height = _a.dot(out.up);
    return out;
  }

  private fillFrame(a: number, t: number, out: TrackProjection): void {
    const n = this.samples.length;
    const b = this.closed ? mod(a + 1, n) : Math.min(a + 1, n - 1);
    const A = this.samples[a];
    const B = this.samples[b];
    out.index = t < 0.5 ? a : b;
    out.t = t;
    out.s = A.s + t * this.spacing;
    if (this.closed && out.s >= this.length) out.s -= this.length;
    out.pos.lerpVectors(A.pos, B.pos, t);
    out.tangent.lerpVectors(A.tangent, B.tangent, t).normalize();
    out.up.lerpVectors(A.up, B.up, t).normalize();
    out.right.crossVectors(out.tangent, out.up).normalize();
    out.up.crossVectors(out.right, out.tangent).normalize();
    out.width = lerp(A.width, B.width, t);
    out.vCurv = lerp(A.vCurv, B.vCurv, t);
    out.curvature = lerp(A.curvature, B.curvature, t);
    const near = t < 0.5 ? a : b;
    out.flags = this.samples[near].flags;
    out.hoverLane = this.samples[near].hoverLane;
    out.wallL = this.wallL[near] === 1;
    out.wallR = this.wallR[near] === 1;
    out.connL = this.connL[near];
    out.connR = this.connR[near];
  }

  /** Interpolated frame at arc length s. */
  frameAt(s: number, out: TrackProjection): TrackProjection {
    const n = this.samples.length;
    if (this.closed) s = mod(s, this.length);
    else s = clamp(s, 0, this.length);
    const f = s / this.spacing;
    let a = Math.floor(f);
    let t = f - a;
    if (this.closed) a = mod(a, n);
    else if (a >= n - 1) {
      a = n - 2;
      t = 1;
    }
    this.fillFrame(a, t, out);
    out.lateral = 0;
    out.height = 0;
    out.overrun = 0;
    return out;
  }

  pointAt(s: number, lateral: number, height: number, out: Vector3, tmp = new TrackProjection()): Vector3 {
    this.frameAt(s, tmp);
    return out.copy(tmp.pos).addScaledVector(tmp.right, lateral).addScaledVector(tmp.up, height);
  }

  indexAt(s: number): number {
    const n = this.samples.length;
    const i = Math.round((this.closed ? mod(s, this.length) : clamp(s, 0, this.length)) / this.spacing);
    return this.closed ? mod(i, n) : clamp(i, 0, n - 1);
  }
}

export interface GridSlot {
  s: number;
  lateral: number;
}

/** A full circuit: main loop plus optional branch shortcuts. */
export class Track {
  readonly main: TrackPath;
  readonly branches: TrackPath[] = [];
  readonly paths: TrackPath[] = [];
  readonly layout: LayoutResult;
  /** Resolved commands (after auto-closing). */
  readonly cmds: LayoutCmd[];
  readonly checkpoints: number[] = [];
  readonly numCheckpoints = 10;

  constructor(public readonly def: TrackDef) {
    this.cmds = def.closeWith ? autoClose(def.cmds, def.closeWith[0], def.closeWith[1]) : def.cmds;
    this.layout = runLayout(this.cmds, def.baseHeight);
    this.main = this.buildMain();
    this.paths.push(this.main);
    def.branches.forEach((bd, i) => {
      const b = this.buildBranch(bd, i + 1);
      this.branches.push(b);
      this.paths.push(b);
    });
    for (const b of this.branches) this.connectBranch(b);
    for (let k = 0; k < this.numCheckpoints; k++) this.checkpoints.push((k / this.numCheckpoints) * this.main.length);
  }

  get length(): number {
    return this.main.length;
  }

  private buildMain(): TrackPath {
    const def = this.def;
    const lay = this.layout;
    const path = TrackPath.fromPoints(0, lay.points.map((p) => p.pos), true);
    const L = path.length;
    const D = lay.totalDistance;
    // Width per command (target width reached over first 40% of a command).
    const widthStart: number[] = [];
    const widthEnd: number[] = [];
    // Use last command's width as the start of the first one for continuity.
    let w = this.cmds.reduce((acc, c) => (c.width !== undefined ? c.width : acc), def.defaultWidth);
    for (const c of this.cmds) {
      widthStart.push(w);
      w = c.width ?? w;
      widthEnd.push(w);
    }
    for (const smp of path.samples) {
      const d = (smp.s / L) * D;
      const ci = cmdAtDistance(lay, d);
      const c = this.cmds[ci];
      const u = (d - lay.cmdStart[ci]) / Math.max(1e-6, lay.cmdEnd[ci] - lay.cmdStart[ci]);
      smp.cmd = ci;
      smp.width = lerp(widthStart[ci], widthEnd[ci], smoothstep(0, 0.4, u));
      let flags = 0;
      for (const tag of c.tags ?? []) flags |= TAG_FLAGS[tag] ?? 0;
      if (c.jump) flags |= TAG_FLAGS.jump;
      smp.flags = flags;
      if (c.hoverLane !== undefined) {
        const edgeFade = smoothstep(0, 0.08, u) * smoothstep(1, 0.92, u);
        smp.hoverLane = edgeFade > 0.5 ? c.hoverLane * (smp.width / 2 - 3.2) : NaN;
      }
    }
    path.computeCurvature(7);
    // Banking from curvature, smoothed.
    const n = path.count;
    const bank = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const smp = path.samples[i];
      const c = this.cmds[smp.cmd];
      const scale = c.bankScale ?? 1;
      bank[i] = clamp(-smp.curvature * def.bankK * scale, -def.maxBank, def.maxBank);
      if (smp.flags & TAG_FLAGS.jump) bank[i] = 0;
    }
    const win = 14;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -win; k <= win; k++) s += bank[mod(i + k, n)];
      path.samples[i].bank = s / (2 * win + 1);
    }
    path.computeFrames();
    return path;
  }

  private buildBranch(bd: BranchDef, index: number): TrackPath {
    const main = this.main;
    const lay = this.layout;
    const L = main.length;
    const D = lay.totalDistance;
    const entryS = mod(((lay.cmdStart[bd.fromCmd] + (bd.fromOffset ?? 0)) / D) * L, L);
    const exitS = mod(((lay.cmdEnd[bd.toCmd] - (bd.toOffset ?? 0)) / D) * L, L);
    const fe = main.frameAt(entryS, new TrackProjection());
    const fx = main.frameAt(exitS, new TrackProjection());
    const latE = bd.side * (fe.width / 2 - bd.width / 2);
    const latX = bd.side * (fx.width / 2 - bd.width / 2);
    const p0 = fe.pos.clone().addScaledVector(fe.right, latE);
    const p1 = fx.pos.clone().addScaledVector(fx.right, latX);
    const chord = p0.distanceTo(p1);
    const t0 = fe.tangent.clone().multiplyScalar(chord * 0.9);
    const t1 = fx.tangent.clone().multiplyScalar(chord * 0.9);
    const chordDir = p1.clone().sub(p0).normalize();
    const side = new Vector3().crossVectors(chordDir, WORLD_UP).normalize();
    const pts: Vector3[] = [];
    const steps = Math.max(12, Math.round(chord / 4));
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h11 = u ** 3 - u ** 2;
      const p = new Vector3()
        .addScaledVector(p0, h00)
        .addScaledVector(t0, h10)
        .addScaledVector(p1, h01)
        .addScaledVector(t1, h11);
      const hump = Math.pow(Math.sin(Math.PI * u), 2);
      if (bd.rise) p.y += bd.rise * hump;
      if (bd.bulge) p.addScaledVector(side, bd.bulge * hump);
      pts.push(p);
    }
    const path = TrackPath.fromPoints(index, pts, false);
    path.id = bd.id;
    path.hoverOnly = bd.hoverOnly;
    path.entryS = entryS;
    path.exitS = exitS;
    path.side = bd.side;
    for (const smp of path.samples) smp.width = bd.width;
    path.computeCurvature(4);
    for (const smp of path.samples) smp.bank = clamp(-smp.curvature * this.def.bankK * 0.6, -0.15, 0.15);
    path.computeFrames();
    return path;
  }

  /** Open walls where a branch and the main road overlap so cars can cross between them. */
  private connectBranch(b: TrackPath): void {
    const main = this.main;
    const proj = new TrackProjection();
    const edge = new Vector3();
    const halfW = b.samples[0].width / 2;
    const scanMain = (startS: number, dir: 1 | -1) => {
      let hits = 0;
      let misses = 0;
      const startIdx = main.indexAt(startS);
      for (let k = 0; k < 200 && misses < 4; k++) {
        const j = main.wrapIndex(startIdx + dir * k);
        const smp = main.samples[j];
        edge.copy(smp.pos).addScaledVector(smp.right, b.side * (smp.width / 2));
        b.project(edge, -1, proj);
        const ok = Math.abs(proj.lateral) <= halfW + 0.35 && Math.abs(proj.height) < 3 && proj.overrun <= 0.5;
        if (ok) {
          hits++;
          misses = 0;
          if (b.side > 0) {
            main.wallR[j] = 0;
            main.connR[j] = b.index;
          } else {
            main.wallL[j] = 0;
            main.connL[j] = b.index;
          }
        } else if (hits > 0) misses++;
        else if (k > 6) break;
      }
    };
    scanMain(b.entryS, 1);
    scanMain(b.exitS, -1);
    // Branch inner side faces the main road.
    const inner = -b.side;
    let hint = -1;
    for (let k = 0; k < b.count; k++) {
      const smp = b.samples[k];
      edge.copy(smp.pos).addScaledVector(smp.right, inner * (smp.width / 2));
      main.project(edge, hint, proj, 60);
      hint = proj.index;
      if (Math.abs(proj.lateral) <= proj.width / 2 + 0.35 && Math.abs(proj.height) < 3) {
        if (inner > 0) {
          b.wallR[k] = 0;
          b.connR[k] = 0;
        } else {
          b.wallL[k] = 0;
          b.connL[k] = 0;
        }
      }
    }
  }

  /** Convert a position on any path into main-track-equivalent distance. */
  mainS(pathIndex: number, s: number): number {
    if (pathIndex === 0) return s;
    const b = this.paths[pathIndex];
    let span = b.exitS - b.entryS;
    if (span < 0) span += this.main.length;
    return mod(b.entryS + (clamp(s, 0, b.length) / b.length) * span, this.main.length);
  }

  /** Starting grid slots (behind the start line at s = 0). */
  gridSlot(i: number): GridSlot {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const s = this.main.length - 14 - row * 10 - col * 4.5;
    const smp = this.main.samples[this.main.indexAt(s)];
    const lane = smp.width / 4.6;
    return { s, lateral: col === 0 ? -lane : lane };
  }
}
