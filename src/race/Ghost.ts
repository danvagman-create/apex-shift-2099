import { Quaternion, Vector3 } from 'three';

/** Frame layout: x, y, z, qx, qy, qz, qw, transform, progressInLap */
const STRIDE = 9;
export const GHOST_HZ = 20;

export class GhostRecorder {
  private frames: number[] = [];
  private acc = 0;
  record(dt: number, pos: Vector3, q: Quaternion, transform: number, lapProgress: number): void {
    this.acc += dt;
    while (this.acc >= 1 / GHOST_HZ) {
      this.acc -= 1 / GHOST_HZ;
      this.frames.push(pos.x, pos.y, pos.z, q.x, q.y, q.z, q.w, transform, lapProgress);
    }
  }
  reset(): void {
    this.frames = [];
    this.acc = 0;
  }
  get length(): number {
    return this.frames.length / STRIDE;
  }
  serialize(): string {
    return encodeFloats(new Float32Array(this.frames));
  }
}

export class GhostPlayer {
  private data: Float32Array;
  readonly frames: number;
  constructor(encoded: string) {
    this.data = decodeFloats(encoded);
    this.frames = Math.floor(this.data.length / STRIDE);
  }
  get duration(): number {
    return this.frames / GHOST_HZ;
  }
  /** Sample ghost state at lap time t. Returns false past the end. */
  sample(t: number, pos: Vector3, q: Quaternion): { transform: number; progress: number } | null {
    if (this.frames < 2) return null;
    const f = t * GHOST_HZ;
    const i = Math.floor(f);
    if (i >= this.frames - 1) return null;
    const k = f - i;
    const a = i * STRIDE;
    const b = a + STRIDE;
    const d = this.data;
    pos.set(d[a] + (d[b] - d[a]) * k, d[a + 1] + (d[b + 1] - d[a + 1]) * k, d[a + 2] + (d[b + 2] - d[a + 2]) * k);
    const qa = new Quaternion(d[a + 3], d[a + 4], d[a + 5], d[a + 6]);
    const qb = new Quaternion(d[b + 3], d[b + 4], d[b + 5], d[b + 6]);
    q.slerpQuaternions(qa, qb, k);
    return { transform: d[a + 7] + (d[b + 7] - d[a + 7]) * k, progress: d[a + 8] + (d[b + 8] - d[a + 8]) * k };
  }
  /** Lap time at which the ghost reached a given lap progress (m), via binary search. */
  timeAtProgress(p: number): number | null {
    let lo = 0;
    let hi = this.frames - 1;
    if (this.frames < 2 || p < this.data[8] || p > this.data[hi * STRIDE + 8]) return null;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.data[mid * STRIDE + 8] < p) lo = mid;
      else hi = mid;
    }
    const pa = this.data[lo * STRIDE + 8];
    const pb = this.data[hi * STRIDE + 8];
    const k = pb > pa ? (p - pa) / (pb - pa) : 0;
    return (lo + k) / GHOST_HZ;
  }
}

export function encodeFloats(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function decodeFloats(b64: string): Float32Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4));
}
