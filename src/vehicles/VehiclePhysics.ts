import { Matrix4, Quaternion, Vector3 } from 'three';
import { approach, clamp, damp, lerp, smoothstep, wrapAngle } from '../core/utils';
import { Track, TrackProjection } from '../track/Track';
import type { VehiclePhysicsSpec } from './VehicleSpecs';

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (+ = right)
  nitro: boolean;
  transform: boolean; // edge-triggered request
}

export const emptyInput = (): DriveInput => ({ throttle: 0, brake: 0, steer: 0, nitro: false, transform: false });

export interface PhysicsEvents {
  wallHit: number; // impact speed m/s
  carHit: number;
  landing: number;
  transformStart: boolean;
  nitroStart: boolean;
  fell: boolean;
  gearShift: number; // +1 up, -1 down
  sparks: number; // 0..1 scrape intensity
}

const G = 9.81;
const WORLD_UP = new Vector3(0, 1, 0);
const _v = new Vector3();
const _w = new Vector3();
const _m = new Matrix4();
const _left = new Vector3();

export class VehiclePhysics {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly up = new Vector3(0, 1, 0);
  readonly forward = new Vector3(0, 0, 1);
  readonly right = new Vector3(-1, 0, 0);
  readonly quaternion = new Quaternion();
  yaw = 0;
  yawRate = 0;
  pathIndex = 0;
  hint = -1;
  readonly proj = new TrackProjection();
  private readonly proj2 = new TrackProjection();
  private readonly proj3 = new TrackProjection();

  // state
  speed = 0; // forward speed (signed)
  grounded = true;
  supported = true;
  airTime = 0;
  targetHover = false;
  transform = 0; // 0 road .. 1 hover
  hoverBlend = 0; // smoothed parameter blend
  rideOffset = 0;
  nitro = 0;
  nitroActive = false;
  drifting = false;
  driftTime = 0;
  driftCharge = 0;
  slip = 0; // slip angle (rad)
  inHoverLane = false;
  draft = 0; // 0..1 slipstream factor (set externally)
  ghost = 0; // seconds of no-collision after respawn
  fallen = false;
  frozen = false;

  // visuals / audio
  bodyPitch = 0;
  bodyRoll = 0;
  private pitchVel = 0;
  private rollVel = 0;
  bounce = 0;
  private bounceVel = 0;
  wheelSpin = 0;
  steerAngle = 0;
  rpm = 0;
  gear = 1;
  throttle = 0;
  brake = 0;
  aLong = 0;
  aLat = 0;
  readonly events: PhysicsEvents = { wallHit: 0, carHit: 0, landing: 0, transformStart: false, nitroStart: false, fell: false, gearShift: 0, sparks: 0 };

  // bookkeeping
  lastSafeS = 0;
  private safeTimer = 0;
  private transformCooldown = 0;
  private driftExitTimer = 0;
  topSpeed = 0;
  distance = 0;

  readonly halfLength: number;
  readonly halfWidth: number;

  constructor(
    public spec: VehiclePhysicsSpec,
    public readonly track: Track,
  ) {
    this.halfLength = spec.length / 2;
    this.halfWidth = spec.width / 2;
    this.nitro = spec.nitroCapacity * 0.5;
  }

  get speedKmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  get isHover(): boolean {
    return this.transform > 0.5;
  }

  get path() {
    return this.track.paths[this.pathIndex];
  }

  /** Place the car on a path at arc length s with lateral offset. */
  placeAt(s: number, lateral: number, pathIndex = 0, speed = 0): void {
    const path = this.track.paths[pathIndex];
    const f = path.frameAt(s, this.proj);
    this.pathIndex = pathIndex;
    this.hint = f.index;
    this.pos.copy(f.pos).addScaledVector(f.right, lateral);
    this.up.copy(f.up);
    this.yaw = Math.atan2(f.tangent.x, f.tangent.z);
    this.yawRate = 0;
    this.vel.copy(f.tangent).multiplyScalar(speed);
    this.speed = speed;
    this.rideOffset = this.transform * this.spec.hoverHeight;
    this.pos.addScaledVector(f.up, this.rideOffset);
    this.grounded = true;
    this.supported = true;
    this.fallen = false;
    this.drifting = false;
    this.slip = 0;
    this.airTime = 0;
    this.lastSafeS = pathIndex === 0 ? s : this.track.mainS(pathIndex, s);
    this.updateBasis();
    this.project();
  }

  /** Reposition after falling / getting stuck. */
  respawn(): void {
    const s = this.lastSafeS - 25;
    this.targetHover = false;
    this.transform = 0;
    this.placeAt(s, 0, 0, 22);
    this.ghost = 2.5;
    this.nitroActive = false;
  }

  setHoverImmediate(hover: boolean): void {
    this.targetHover = hover;
    this.transform = hover ? 1 : 0;
    this.hoverBlend = this.transform;
  }

  private project(): TrackProjection {
    const path = this.path;
    path.project(this.pos, this.hint, this.proj);
    this.hint = this.proj.index;
    return this.proj;
  }

  private updateBasis(): void {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.forward.addScaledVector(this.up, -this.forward.dot(this.up)).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    _left.crossVectors(this.up, this.forward).normalize();
    _m.makeBasis(_left, this.up, this.forward);
    this.quaternion.setFromRotationMatrix(_m);
  }

  private resetEvents(): void {
    const e = this.events;
    e.wallHit = 0;
    e.carHit = 0;
    e.landing = 0;
    e.transformStart = false;
    e.nitroStart = false;
    e.fell = false;
    e.gearShift = 0;
    e.sparks = 0;
  }

  /** Clears per-frame events (call once per rendered frame, before substeps). */
  beginFrame(): void {
    this.resetEvents();
  }

  step(dt: number, input: DriveInput): void {
    const sp = this.spec;
    if (this.ghost > 0) this.ghost -= dt;
    if (this.frozen) {
      this.vel.set(0, 0, 0);
      this.speed = 0;
      this.throttle = input.throttle;
      this.updateRpm(dt, input.throttle);
      return;
    }

    // ---- transformation -------------------------------------------------
    this.transformCooldown -= dt;
    if (input.transform && this.transformCooldown <= 0) {
      this.targetHover = !this.targetHover;
      this.transformCooldown = sp.transformTime * 0.6;
      this.events.transformStart = true;
      this.drifting = false;
    }
    this.transform = approach(this.transform, this.targetHover ? 1 : 0, dt / sp.transformTime);
    this.hoverBlend = smoothstep(0.2, 0.9, this.transform);
    const m = this.hoverBlend;
    const transforming = this.transform > 0.02 && this.transform < 0.98;

    // ---- track frame ----------------------------------------------------
    const proj = this.project();
    const path = this.path;
    const onSurface = Math.abs(proj.lateral) <= proj.width / 2 + 0.6 && proj.overrun <= 0;
    this.supported = onSurface && !(path.hoverOnly && this.transform < 0.5);

    if (this.grounded) this.up.lerp(proj.up, 1 - Math.exp(-14 * dt)).normalize();
    else this.up.lerp(WORLD_UP, 1 - Math.exp(-1.2 * dt)).normalize();
    this.updateBasis();

    let vf = this.vel.dot(this.forward);
    let vr = this.vel.dot(this.right);
    const V = Math.hypot(vf, vr);

    // ---- blended parameters ---------------------------------------------
    const maxSpeed = lerp(sp.maxSpeed, sp.hoverMaxSpeed, m);
    const accel = lerp(sp.accel, sp.hoverAccel, m);
    const grip = lerp(sp.grip, sp.hoverGrip, m);
    const steerRate = lerp(sp.steerRate, sp.hoverSteer, m);
    const brakeDecel = lerp(sp.brake, sp.hoverBrake, m);

    // ---- nitro ------------------------------------------------------------
    const wantNitro = input.nitro && this.nitro > 0.02 && vf > 2;
    if (wantNitro && !this.nitroActive) {
      if (this.nitro > 0.25) {
        this.nitroActive = true;
        this.events.nitroStart = true;
      }
    } else if (!wantNitro) this.nitroActive = false;
    if (this.nitroActive) {
      this.nitro -= dt;
      if (this.nitro <= 0) {
        this.nitro = 0;
        this.nitroActive = false;
      }
    } else {
      this.nitro = Math.min(sp.nitroCapacity, this.nitro + sp.nitroRecharge * dt);
    }

    this.inHoverLane =
      m > 0.6 && this.pathIndex === 0 && !isNaN(proj.hoverLane) && Math.abs(proj.lateral - proj.hoverLane) < 3.2;
    if (this.inHoverLane) this.nitro = Math.min(sp.nitroCapacity, this.nitro + 0.32 * dt);
    const pathBonus = path.hoverOnly ? 0.05 : 0;

    const cap =
      maxSpeed *
      (1 + (this.nitroActive ? sp.nitroSpeedBonus : 0) + (this.inHoverLane ? 0.07 : 0) + pathBonus + this.draft * 0.045);

    this.throttle = input.throttle;
    this.brake = input.brake;
    const prevVf = vf;

    if (this.grounded) {
      // ---- longitudinal --------------------------------------------------
      let a = 0;
      const thrustScale = transforming ? 0.55 : 1;
      const brakeIn = this.drifting ? input.brake * 0.25 : input.brake;
      if (input.throttle > 0) {
        if (vf > -0.5) {
          const ratio = Math.max(0, vf) / cap;
          a += accel * input.throttle * thrustScale * Math.max(0, 1 - ratio * ratio * ratio);
          if (this.inHoverLane) a += 3 * input.throttle;
        } else a += brakeDecel * input.throttle;
      }
      if (this.nitroActive) a += sp.nitroForce * (vf < cap ? 1 : 0.15);
      if (brakeIn > 0) {
        if (vf > 0.5) a -= brakeDecel * brakeIn;
        else if (vf > -16) a -= 8 * brakeIn;
      }
      const aero = (m > 0.5 ? 0.00042 : 0.00058) * (1 - this.draft * 0.4);
      let resist = aero * vf * Math.abs(vf) + Math.sign(vf) * (0.35 + (input.throttle < 0.05 && brakeIn < 0.05 ? 1.4 : 0));
      if (vf > cap) resist += (vf - cap) * 1.2;
      if (this.drifting) resist += Math.sign(vf) * Math.abs(Math.sin(this.slip)) * 4.5;
      a -= resist;
      vf += a * dt;
      if (Math.sign(vf) !== Math.sign(prevVf) && input.throttle < 0.05 && brakeIn < 0.05) vf = 0;
      this.aLong = (vf - prevVf) / dt;

      // ---- drift state ------------------------------------------------------
      const absSteer = Math.abs(input.steer);
      if (!this.drifting) {
        if (m < 0.3 && V > 20 && absSteer > 0.45 && input.brake > 0.3 && input.throttle > 0.2) {
          this.drifting = true;
          this.driftTime = 0;
        }
      } else {
        this.driftTime += dt;
        if (absSteer < 0.15) this.driftExitTimer += dt;
        else this.driftExitTimer = 0;
        if (this.driftExitTimer > 0.22 || V < 12 || m > 0.3 || (this.driftTime > 0.5 && Math.abs(this.slip) < 0.04)) {
          this.drifting = false;
          this.driftExitTimer = 0;
        }
      }

      // ---- yaw ---------------------------------------------------------------
      const absV = Math.abs(vf);
      const lowF = clamp(absV / 5, 0, 1);
      const highF = 0.3 + 0.7 / (1 + absV / 48);
      const dirSign = vf >= 0 ? 1 : -1;
      let targetYaw: number;
      if (this.drifting) {
        const lim = (grip * 1.9) / Math.max(absV, 6);
        targetYaw = -input.steer * Math.min(steerRate * 1.35, lim);
        // keep slip angle bounded
        if (Math.abs(this.slip) > 0.62 && Math.sign(targetYaw) === Math.sign(this.slip)) targetYaw *= 0.2;
        this.driftCharge += dt * Math.abs(Math.sin(this.slip)) * (absV / 40);
        this.nitro = Math.min(sp.nitroCapacity, this.nitro + dt * Math.abs(Math.sin(this.slip)) * 0.9);
      } else {
        const lim = (grip * (m > 0.5 ? 1.25 : 1.08)) / Math.max(absV, 4);
        targetYaw = -input.steer * Math.min(steerRate * lowF * highF, lim) * dirSign;
        // self-align toward velocity direction when sliding
        targetYaw += -this.slip * (m > 0.5 ? 0.6 : 2.2) * clamp(absV / 15, 0, 1);
      }
      const yawResp = m > 0.5 ? 4.5 : 9;
      this.yawRate = damp(this.yawRate, targetYaw, yawResp, dt);
      this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

      // ---- lateral grip -----------------------------------------------------
      const latCap = this.drifting ? grip * (0.75 + 0.5 * sp.driftGrip) : grip;
      const dvr = clamp(-vr, -latCap * dt, latCap * dt);
      vr += dvr;
      this.aLat = dvr / dt;
      if (this.drifting) vr *= 1 - 0.4 * dt;

      // re-express velocity in the rotated frame
      const oldF = this.forward.clone();
      const oldR = this.right.clone();
      this.updateBasis();
      _v.copy(oldF).multiplyScalar(vf).addScaledVector(oldR, vr);
      vf = _v.dot(this.forward);
      vr = _v.dot(this.right);
      this.vel.copy(this.forward).multiplyScalar(vf).addScaledVector(this.right, vr);
      this.slip = Math.abs(vf) > 3 ? Math.atan2(vr, Math.abs(vf)) : 0;

      // ---- launch over crests ----------------------------------------------
      const slope = Math.abs(proj.tangent.y);
      if (!this.supported) {
        this.grounded = false;
      } else if (vf * vf * proj.vCurv > G * Math.sqrt(1 - slope * slope) * 0.95 && vf > 8) {
        this.grounded = false;
        this.airTime = 0;
      }
    } else {
      // ---- airborne ----------------------------------------------------------
      this.airTime += dt;
      this.vel.y -= G * dt;
      if (this.nitroActive) this.vel.addScaledVector(this.forward, sp.nitroForce * 0.6 * dt);
      const targetYaw = -input.steer * steerRate * 0.25;
      this.yawRate = damp(this.yawRate, targetYaw, 3, dt);
      this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
      this.vel.multiplyScalar(1 - 0.00025 * this.vel.length() * dt);
      this.aLong = 0;
      this.aLat = 0;
    }

    // ---- integrate ----------------------------------------------------------
    this.pos.addScaledVector(this.vel, dt);
    this.distance += this.vel.length() * dt;

    // ---- path switching / surface -----------------------------------------
    this.handlePathSwitch();
    const p2 = this.path.project(this.pos, this.hint, this.proj2);
    this.hint = p2.index;
    this.proj.index = p2.index;
    const onSurf2 = Math.abs(p2.lateral) <= p2.width / 2 + 0.6 && p2.overrun <= 0;
    this.supported = onSurf2 && !(this.path.hoverOnly && this.transform < 0.5);

    const bob = m > 0.01 ? Math.sin(performanceNow() * 0.0042 + this.yaw * 3) * 0.05 * m : 0;
    const targetRide = this.transform * this.transform * (3 - 2 * this.transform) * sp.hoverHeight + bob;
    this.rideOffset = damp(this.rideOffset, targetRide, 10, dt);

    if (this.grounded) {
      if (!this.supported) {
        this.grounded = false;
      } else {
        // snap to surface + ride height, remove normal velocity
        const lat = p2.lateral;
        this.pos.copy(p2.pos).addScaledVector(p2.right, lat).addScaledVector(p2.up, this.rideOffset);
        const vn = this.vel.dot(p2.up);
        this.vel.addScaledVector(p2.up, -vn);
      }
    } else if (this.supported && p2.height <= this.rideOffset + 0.02 && p2.height > -4) {
      // landing
      const vn = -this.vel.dot(p2.up);
      this.events.landing = Math.max(this.events.landing, vn);
      this.vel.addScaledVector(p2.up, vn);
      if (vn > 9) this.vel.multiplyScalar(0.94);
      this.pos.copy(p2.pos).addScaledVector(p2.right, p2.lateral).addScaledVector(p2.up, this.rideOffset);
      this.grounded = true;
      this.bounceVel -= Math.min(vn, 14) * 0.09;
      this.airTime = 0;
    }

    // ---- walls ---------------------------------------------------------------
    this.collideWalls(p2);

    // ---- falling ---------------------------------------------------------------
    if (!this.grounded && (p2.height < -10 || Math.abs(p2.lateral) > p2.width / 2 + 60)) {
      if (!this.fallen) {
        this.fallen = true;
        this.events.fell = true;
      }
    }

    // ---- safe point ------------------------------------------------------------
    this.safeTimer += dt;
    if (this.safeTimer > 0.4) {
      this.safeTimer = 0;
      if (this.grounded && this.supported && this.pathIndex === 0 && Math.abs(p2.lateral) < p2.width / 2 - 1.5) {
        this.lastSafeS = p2.s;
      }
    }

    // ---- derived values ----------------------------------------------------
    this.speed = this.vel.dot(this.forward);
    this.topSpeed = Math.max(this.topSpeed, this.speed);
    this.updateBasis();
    this.updateVisuals(dt, input);
    this.updateRpm(dt, input.throttle);
  }

  private handlePathSwitch(): void {
    const track = this.track;
    const path = this.path;
    const p = path.project(this.pos, this.hint, this.proj2);
    this.hint = p.index;
    if (path.index !== 0) {
      // Leaving a branch at its ends.
      if (p.overrun > 0 && p.s > path.length * 0.5) {
        this.switchTo(0, track.main.indexAt(path.exitS));
        return;
      }
      if (p.overrun > 0 && p.s < path.length * 0.5) {
        this.switchTo(0, track.main.indexAt(path.entryS));
        return;
      }
    }
    const half = p.width / 2;
    if (Math.abs(p.lateral) > half - 0.2) {
      const conn = p.lateral > 0 ? p.connR : p.connL;
      if (conn >= 0) {
        const q = track.paths[conn];
        const hint = conn === 0 ? track.main.indexAt(track.mainS(path.index, p.s)) : -1;
        const qp = q.project(this.pos, hint, this.proj3, 60);
        if (Math.abs(qp.lateral) < qp.width / 2 - 0.1 && qp.overrun <= 0 && Math.abs(qp.height - this.rideOffset) < 4) {
          if (Math.abs(p.lateral) > half || Math.abs(qp.lateral) < Math.abs(p.lateral) - 1) {
            this.switchTo(conn, qp.index);
          }
        }
      }
    }
  }

  private switchTo(pathIndex: number, hint: number): void {
    this.pathIndex = pathIndex;
    this.hint = hint;
  }

  private collideWalls(p: TrackProjection): void {
    const half = p.width / 2;
    // heading relative to track
    const fx = this.forward.dot(p.tangent);
    const fr = this.forward.dot(p.right);
    const ext = Math.abs(fr) * this.halfLength + Math.abs(fx) * this.halfWidth;
    const limit = half - ext * 0.92;
    if (limit <= 0) return;
    let side = 0;
    if (p.lateral > limit && p.wallR) side = 1;
    else if (p.lateral < -limit && p.wallL) side = -1;
    if (side === 0) return;
    // Do not collide when well beyond the edge (e.g., falling) — only the barrier band.
    if (Math.abs(p.lateral) > half + 3) return;
    const pen = Math.abs(p.lateral) - limit;
    this.pos.addScaledVector(p.right, -side * pen);
    const vLat = this.vel.dot(p.right) * side;
    if (vLat > 0) {
      const restitution = 0.25;
      this.vel.addScaledVector(p.right, -side * vLat * (1 + restitution));
      const scrape = Math.min(0.45, vLat * 0.022);
      _w.copy(p.tangent).multiplyScalar(this.vel.dot(p.tangent));
      this.vel.addScaledVector(_w, -scrape);
      this.events.wallHit = Math.max(this.events.wallHit, vLat);
      this.drifting = false;
    }
    // align heading with wall
    const trackYaw = Math.atan2(p.tangent.x, p.tangent.z);
    const forwardDir = this.forward.dot(p.tangent) >= 0 ? trackYaw : wrapAngle(trackYaw + Math.PI);
    const diff = wrapAngle(forwardDir - this.yaw);
    this.yaw = wrapAngle(this.yaw + diff * Math.min(1, 0.08 + Math.max(0, vLat) * 0.02));
    this.yawRate *= 0.5;
    this.events.sparks = Math.max(this.events.sparks, clamp(Math.abs(this.speed) / 40, 0.2, 1));
  }

  private updateVisuals(dt: number, input: DriveInput): void {
    const m = this.hoverBlend;
    // weight transfer springs
    const pitchTarget = clamp(-this.aLong * (m > 0.5 ? 0.0028 : 0.0042), -0.07, 0.08);
    const rollTarget = clamp(-this.aLat * (m > 0.5 ? 0.006 : 0.0028), -0.09, 0.09) + (m > 0.5 ? -input.steer * 0.06 * clamp(this.speed / 30, 0, 1) : 0);
    const k = 90;
    const c = 12;
    this.pitchVel += ((pitchTarget - this.bodyPitch) * k - this.pitchVel * c) * dt;
    this.bodyPitch += this.pitchVel * dt;
    this.rollVel += ((rollTarget - this.bodyRoll) * k - this.rollVel * c) * dt;
    this.bodyRoll += this.rollVel * dt;
    this.bounceVel += (-this.bounce * 160 - this.bounceVel * 10) * dt;
    this.bounce += this.bounceVel * dt;
    if (!this.grounded) {
      // nose follows trajectory a bit
      this.bodyPitch = damp(this.bodyPitch, clamp(-this.vel.y * 0.012, -0.25, 0.25), 2, dt);
    }
    this.wheelSpin += (this.speed * dt) / 0.36;
    this.steerAngle = damp(this.steerAngle, -input.steer * 0.42 * (1 / (1 + Math.abs(this.speed) / 40)), 12, dt);
  }

  private updateRpm(dt: number, throttle: number): void {
    const gears = 7;
    const vmax = this.spec.maxSpeed * 1.1;
    const v = Math.abs(this.speed);
    let g = 1;
    let lo = 0;
    let hi = vmax / gears;
    for (let i = 1; i <= gears; i++) {
      lo = vmax * Math.pow((i - 1) / gears, 0.8);
      hi = vmax * Math.pow(i / gears, 0.8);
      g = i;
      if (v < hi) break;
    }
    if (g !== this.gear) {
      this.events.gearShift = g > this.gear ? 1 : -1;
      this.gear = g;
    }
    const inGear = clamp((v - lo) / Math.max(1, hi - lo), 0, 1);
    const target = this.grounded ? 0.18 + 0.78 * inGear + (v < 2 ? throttle * 0.35 : 0) : 0.5 + throttle * 0.45;
    this.rpm = damp(this.rpm, clamp(target, 0.12, 1), 14, dt);
  }
}

const performanceNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Resolve car-to-car collisions using two circles per car. */
export function resolveCarCollisions(cars: VehiclePhysics[]): void {
  const R = 1.05;
  const off = 1.15;
  const a1 = new Vector3();
  const a2 = new Vector3();
  const b1 = new Vector3();
  const b2 = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < cars.length; i++) {
    const A = cars[i];
    if (A.ghost > 0 || A.fallen) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const B = cars[j];
      if (B.ghost > 0 || B.fallen) continue;
      const dx = A.pos.x - B.pos.x;
      const dz = A.pos.z - B.pos.z;
      const dy = A.pos.y - B.pos.y;
      if (dx * dx + dz * dz > 49 || Math.abs(dy) > 2.5) continue;
      a1.copy(A.pos).addScaledVector(A.forward, off);
      a2.copy(A.pos).addScaledVector(A.forward, -off);
      b1.copy(B.pos).addScaledVector(B.forward, off);
      b2.copy(B.pos).addScaledVector(B.forward, -off);
      let best = Infinity;
      const pa = new Vector3();
      const pb = new Vector3();
      for (const ca of [a1, a2, A.pos]) {
        for (const cb of [b1, b2, B.pos]) {
          const d = ca.distanceToSquared(cb);
          if (d < best) {
            best = d;
            pa.copy(ca);
            pb.copy(cb);
          }
        }
      }
      const minD = R * 2;
      if (best >= minD * minD) continue;
      const d = Math.sqrt(best) || 0.001;
      n.subVectors(pa, pb);
      n.y = 0;
      if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
      n.normalize();
      const pen = minD - d;
      const ma = A.spec.mass;
      const mb = B.spec.mass;
      const wa = mb / (ma + mb);
      const wb = ma / (ma + mb);
      A.pos.addScaledVector(n, pen * wa);
      B.pos.addScaledVector(n, -pen * wb);
      const rel = _v.subVectors(A.vel, B.vel).dot(n);
      if (rel < 0) {
        const e = 0.3;
        const jImp = (-(1 + e) * rel) / (1 / ma + 1 / mb);
        A.vel.addScaledVector(n, jImp / ma);
        B.vel.addScaledVector(n, -jImp / mb);
        const impact = -rel;
        A.events.carHit = Math.max(A.events.carHit, impact);
        B.events.carHit = Math.max(B.events.carHit, impact);
        // small yaw disturbance
        const side = Math.sign(n.dot(A.right));
        A.yawRate += side * Math.min(1.2, impact * 0.05) * wa;
        B.yawRate -= side * Math.min(1.2, impact * 0.05) * wb;
        A.drifting = false;
        B.drifting = false;
      }
    }
  }
}
