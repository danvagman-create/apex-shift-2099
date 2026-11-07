import { clamp, mod } from '../core/utils';
import type { TrackPath } from './Track';

/**
 * Minimum-curvature-ish racing line computed by constrained Laplacian smoothing of
 * lateral offsets, plus a curvature based speed profile per vehicle capability.
 */
export class RacingLine {
  /** Lateral offset per path sample. */
  readonly offset: Float32Array;
  /** Curvature (1/m, unsigned) of the racing line per sample. */
  readonly curvature: Float32Array;
  /** Signed curvature (+ = left). */
  readonly signedCurvature: Float32Array;
  readonly n: number;

  constructor(
    public readonly path: TrackPath,
    margin = 2.6,
  ) {
    const n = path.count;
    this.n = n;
    this.offset = new Float32Array(n);
    this.curvature = new Float32Array(n);
    this.signedCurvature = new Float32Array(n);
    if (path.closed) this.optimize(margin);
    this.computeCurvature();
  }

  private optimize(margin: number): void {
    const path = this.path;
    const n = this.n;
    const levels = [9, 3, 1];
    let prevStride = 0;
    let coarse: Float32Array | null = null;
    for (const stride of levels) {
      const m = Math.floor(n / stride);
      const off = new Float32Array(m);
      const lim = new Float32Array(m);
      const cx = new Float32Array(m);
      const cz = new Float32Array(m);
      const rx = new Float32Array(m);
      const rz = new Float32Array(m);
      for (let k = 0; k < m; k++) {
        const smp = path.samples[k * stride];
        cx[k] = smp.pos.x;
        cz[k] = smp.pos.z;
        rx[k] = smp.right.x;
        rz[k] = smp.right.z;
        const rl = Math.hypot(rx[k], rz[k]) || 1;
        rx[k] /= rl;
        rz[k] /= rl;
        lim[k] = Math.max(0, smp.width / 2 - margin);
        if (coarse && prevStride) {
          // upsample previous level
          const f = (k * stride) / prevStride;
          const a = Math.floor(f);
          const t = f - a;
          const cm = coarse.length;
          off[k] = coarse[mod(a, cm)] * (1 - t) + coarse[mod(a + 1, cm)] * t;
        }
      }
      const iters = stride === 9 ? 2500 : stride === 3 ? 900 : 300;
      for (let it = 0; it < iters; it++) {
        for (let k = 0; k < m; k++) {
          const a = k === 0 ? m - 1 : k - 1;
          const b = k === m - 1 ? 0 : k + 1;
          const px = (cx[a] + rx[a] * off[a] + cx[b] + rx[b] * off[b]) * 0.5;
          const pz = (cz[a] + rz[a] * off[a] + cz[b] + rz[b] * off[b]) * 0.5;
          const target = (px - cx[k]) * rx[k] + (pz - cz[k]) * rz[k];
          off[k] = clamp(off[k] + (target - off[k]) * 0.9, -lim[k], lim[k]);
        }
      }
      coarse = off;
      prevStride = stride;
    }
    if (coarse) for (let i = 0; i < n; i++) this.offset[i] = coarse[Math.min(i, coarse.length - 1)];
  }

  private computeCurvature(): void {
    const n = this.n;
    const path = this.path;
    const px = new Float32Array(n);
    const pz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = path.samples[i];
      px[i] = s.pos.x + s.right.x * this.offset[i];
      pz[i] = s.pos.z + s.right.z * this.offset[i];
    }
    const span = 3;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = path.closed ? mod(i - span, n) : Math.max(0, i - span);
      const b = path.closed ? mod(i + span, n) : Math.min(n - 1, i + span);
      const ax = px[i] - px[a];
      const az = pz[i] - pz[a];
      const bx = px[b] - px[i];
      const bz = pz[b] - pz[i];
      const h1 = Math.atan2(ax, az);
      let dh = Math.atan2(bx, bz) - h1;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      const len = (Math.hypot(ax, az) + Math.hypot(bx, bz)) * 0.5;
      raw[i] = len > 1e-3 ? dh / len : 0;
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      for (let k = -3; k <= 3; k++) {
        const j = path.closed ? mod(i + k, n) : i + k;
        if (j < 0 || j >= n) continue;
        s += raw[j];
        c++;
      }
      this.signedCurvature[i] = s / c;
      this.curvature[i] = Math.abs(s / c);
    }
  }

  /**
   * Speed profile (m/s) for a vehicle with the given capabilities.
   * grip: lateral accel limit, accel: peak accel, brake: decel, vmax: top speed.
   */
  speedProfile(grip: number, accel: number, brake: number, vmax: number): Float32Array {
    const n = this.n;
    const path = this.path;
    const ds = path.spacing;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const smp = path.samples[i];
      // Banking into the corner adds effective grip.
      const bankHelp = Math.max(0, -Math.sign(this.signedCurvature[i]) * smp.bank) * 9.81;
      const k = Math.max(this.curvature[i], 1e-5);
      v[i] = Math.min(vmax, Math.sqrt((grip + bankHelp) / k));
    }
    const passes = path.closed ? 2 : 1;
    for (let p = 0; p < passes; p++) {
      // backward: braking
      for (let ii = n - 1; ii >= 0; ii--) {
        const i = ii;
        const j = path.closed ? mod(i + 1, n) : Math.min(n - 1, i + 1);
        const lim = Math.sqrt(v[j] * v[j] + 2 * brake * ds);
        if (v[i] > lim) v[i] = lim;
      }
      // forward: acceleration (power fades toward top speed)
      for (let i = 0; i < n; i++) {
        const j = path.closed ? mod(i - 1, n) : Math.max(0, i - 1);
        const a = accel * Math.max(0.05, 1 - Math.pow(v[j] / vmax, 3));
        const lim = Math.sqrt(v[j] * v[j] + 2 * a * ds);
        if (v[i] > lim) v[i] = lim;
      }
    }
    return v;
  }
}
