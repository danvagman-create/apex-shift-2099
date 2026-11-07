import * as THREE from 'three';
import { clamp, damp, lerp, noise1, wrapAngle } from '../core/utils';
import type { CameraMode } from '../core/Settings';
import type { VehiclePhysics } from '../vehicles/VehiclePhysics';
import type { CarModel } from '../vehicles/CarModel';

export interface CameraFeel {
  dynamicFov: boolean;
  shake: number; // 0..1 user setting
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Chase / hood / cockpit cameras with speed-dependent feel and cinematic shots. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private yaw = 0;
  private dist = 6;
  private height = 1.8;
  private fov = 64;
  private trauma = 0;
  private time = 0;
  private upSmooth = new THREE.Vector3(0, 1, 0);
  private lookBackBlend = 0;
  private initialized = false;
  speedNorm = 0;

  constructor(aspect: number, far: number) {
    this.camera = new THREE.PerspectiveCamera(64, aspect, 0.1, far);
  }

  addTrauma(t: number): void {
    this.trauma = clamp(this.trauma + t, 0, 1);
  }

  reset(car: VehiclePhysics): void {
    this.yaw = car.yaw;
    this.initialized = true;
    this.upSmooth.copy(car.up);
  }

  /** Main gameplay camera update. */
  update(dt: number, car: VehiclePhysics, model: CarModel, feel: CameraFeel, lookBack: boolean, inTunnel: boolean): void {
    this.time += dt;
    if (!this.initialized) this.reset(car);
    const cam = this.camera;
    const v = Math.max(0, car.speed);
    const sn = clamp(v / 115, 0, 1.3);
    this.speedNorm = sn;
    const nitro = car.nitroActive ? 1 : 0;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.lookBackBlend = damp(this.lookBackBlend, lookBack ? 1 : 0, 14, dt);

    // FOV: wide at speed; nitro kick
    const baseFov = this.mode === 'cockpit' ? 70 : this.mode === 'hood' ? 68 : 62;
    const targetFov = feel.dynamicFov ? baseFov + Math.pow(Math.min(sn, 1.15), 1.4) * 24 + nitro * 9 : baseFov + 8;
    this.fov = damp(this.fov, targetFov, nitro ? 5 : 2.5, dt);
    cam.fov = this.fov;

    this.upSmooth.lerp(car.grounded ? car.up : UP, 1 - Math.exp(-4 * dt)).normalize();

    if (this.mode === 'chase' || this.mode === 'far') {
      const far = this.mode === 'far';
      // Camera yaw lags heading: swings out in corners, catches up on straights.
      const headingYaw = Math.atan2(car.vel.x, car.vel.z);
      const useVel = v > 8 && car.grounded;
      const target = useVel ? lerpAngle(car.yaw, headingYaw, 0.35) : car.yaw;
      this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-(far ? 4 : 5.5) * dt));
      const baseDist = far ? 9.2 : 6.1;
      const accelPull = clamp(car.aLong * 0.035, -0.6, 0.9);
      this.dist = damp(this.dist, baseDist + sn * 1.2 + accelPull + nitro * 0.9, 3, dt);
      const hTarget = (far ? 3.0 : 1.75) - sn * 0.25 + car.transform * 0.35;
      this.height = damp(this.height, hTarget, 3, dt);
      const yaw = this.yaw + this.lookBackBlend * Math.PI;
      const fwd = _f.set(Math.sin(yaw), 0, Math.cos(yaw));
      const pos = _w.copy(car.pos).addScaledVector(fwd, -this.dist).addScaledVector(this.upSmooth, this.height);
      if (inTunnel) pos.y = Math.min(pos.y, car.pos.y + 3.2);
      cam.position.copy(pos);
      const look = _v.copy(car.pos).addScaledVector(fwd, 3.5 + sn * 3).addScaledVector(this.upSmooth, 0.85 - sn * 0.1);
      cam.up.copy(this.upSmooth);
      cam.lookAt(look);
      // subtle roll with lateral g
      cam.rotateZ(clamp(-car.aLat * 0.0018, -0.05, 0.05));
    } else {
      // hood / cockpit attached to body
      const anchor = this.mode === 'hood' ? model.hoodAnchor : model.cockpitAnchor;
      model.bodyPivot.updateWorldMatrix(true, false);
      const p = _v.copy(anchor);
      if (this.mode === 'cockpit') p.add(_w.set(0.3, 0.05, -0.1));
      model.bodyPivot.localToWorld(p);
      cam.position.copy(p);
      model.bodyPivot.getWorldQuaternion(_q);
      cam.quaternion.copy(_q);
      cam.rotateY(Math.PI + this.lookBackBlend * Math.PI);
      cam.rotateX(-0.04);
    }

    // shake: speed rumble + trauma
    const s = feel.shake;
    const rumble = (sn > 0.55 ? (sn - 0.55) * 0.012 : 0) * (car.grounded ? 1 : 0.3) + nitro * 0.004;
    const tr = this.trauma * this.trauma * 0.06;
    const amp = (rumble + tr) * s;
    if (amp > 0) {
      const t = this.time * 38;
      cam.rotateX(noise1(t) * amp);
      cam.rotateY(noise1(t + 17.3) * amp);
      cam.rotateZ(noise1(t + 41.1) * amp * 0.6);
    }
    cam.near = this.mode === 'cockpit' ? 0.04 : 0.1;
    cam.updateProjectionMatrix();
  }

  /** Orbiting intro shot around a car (countdown). t in seconds since start. */
  intro(dt: number, car: VehiclePhysics, t: number, duration: number): void {
    const cam = this.camera;
    const k = clamp(t / duration, 0, 1);
    const ease = k * k * (3 - 2 * k);
    const ang = car.yaw + lerp(2.4, Math.PI * 0.98, ease);
    const dist = lerp(9, 6.2, ease);
    const h = lerp(2.6, 1.8, ease);
    cam.position.set(car.pos.x + Math.sin(ang) * dist, car.pos.y + h, car.pos.z + Math.cos(ang) * dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(car.pos.x, car.pos.y + 0.7, car.pos.z);
    this.fov = damp(this.fov, 56, 2, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    this.yaw = car.yaw;
    this.dist = 6.1;
    this.height = 1.75;
  }

  /** Slow orbit after the finish. */
  finish(dt: number, car: VehiclePhysics, t: number): void {
    const cam = this.camera;
    const ang = car.yaw + 0.6 + t * 0.25;
    cam.position.set(car.pos.x + Math.sin(ang) * 8, car.pos.y + 2.4, car.pos.z + Math.cos(ang) * 8);
    cam.up.set(0, 1, 0);
    cam.lookAt(car.pos.x, car.pos.y + 0.6, car.pos.z);
    this.fov = damp(this.fov, 50, 1.5, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}
