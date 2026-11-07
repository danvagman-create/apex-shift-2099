import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { clamp, damp, lerp, Rng, smoothstep } from '../core/utils';
import type { RenderContext } from '../core/RenderContext';
import { buildEnvironment } from '../graphics/Environment';
import { glowSprite, hexTexture } from '../graphics/TextureFactory';
import { CarModel, type CarLook } from '../vehicles/CarModel';
import { getVehicle } from '../vehicles/VehicleSpecs';

export type ShowroomMode = 'menu' | 'garage' | 'select';

let rectLibInit = false;

/**
 * Luxury garage / showroom used as the cinematic main-menu backdrop and the
 * interactive 3D garage.
 */
export class ShowroomScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  private car: CarModel | null = null;
  private outgoing: CarModel | null = null;
  private outgoingT = 0;
  private incomingT = 1;
  private turntable = new THREE.Group();
  private ringMat: THREE.MeshBasicMaterial;
  private dust: THREE.Points;
  private shafts: THREE.Mesh[] = [];
  private envTex: THREE.Texture;
  private reflector: Reflector | null = null;
  private time = 0;
  mode: ShowroomMode = 'menu';
  // orbit control state
  private yaw = 0.6;
  private pitch = 0.18;
  private dist = 8.2;
  private targetYaw = 0.6;
  private targetPitch = 0.18;
  private targetDist = 8.2;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private idleTimer = 0;
  private turntableSpeed = 0.12;
  private readonly lookTarget = new THREE.Vector3(0, 0.6, 0);
  private carTransform = 0;
  carTransformTarget = 0;
  private detachFns: (() => void)[] = [];

  constructor(private readonly ctx: RenderContext) {
    if (!rectLibInit) {
      RectAreaLightUniformsLib.init();
      rectLibInit = true;
    }
    const s = this.scene;
    s.background = new THREE.Color('#05060a');
    s.fog = new THREE.FogExp2('#05060a', 0.016);
    this.envTex = buildEnvironment(ctx.renderer, 'showroom');
    s.environment = this.envTex;
    s.environmentIntensity = 0.75;

    // ---- floor
    const cfg = ctx.config;
    if (cfg.showroomReflector) {
      const refl = new Reflector(new THREE.CircleGeometry(40, 64), {
        textureWidth: 1024,
        textureHeight: 1024,
        color: 0x24272d,
        clipBias: 0.003,
      });
      refl.rotation.x = -Math.PI / 2;
      refl.position.y = -0.002;
      s.add(refl);
      this.reflector = refl;
    }
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#0a0b0f',
      roughness: 0.6,
      metalness: 0.15,
      transparent: !!this.reflector,
      opacity: this.reflector ? 0.93 : 1,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);

    // grid lines on floor
    const grid = new THREE.GridHelper(60, 30, 0x1b2b3a, 0x10161e);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = 0.003;
    s.add(grid);

    // ---- turntable
    const plat = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.75, 0.12, 96),
      new THREE.MeshStandardMaterial({ color: '#111318', roughness: 0.25, metalness: 0.85 }),
    );
    plat.position.y = 0.06;
    plat.receiveShadow = true;
    this.turntable.add(plat);
    const hexMat = new THREE.MeshBasicMaterial({ map: hexTexture(), color: new THREE.Color('#29e8ff').multiplyScalar(0.08), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    hexMat.map!.repeat.set(5, 5);
    const hex = new THREE.Mesh(new THREE.CircleGeometry(3.5, 64), hexMat);
    hex.rotation.x = -Math.PI / 2;
    hex.position.y = 0.122;
    this.turntable.add(hex);
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#29e8ff').multiplyScalar(3), toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.68, 0.025, 8, 128), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.11;
    this.turntable.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.012, 6, 128), this.ringMat);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.125;
    this.turntable.add(ring2);
    s.add(this.turntable);

    // ---- architecture: curved wall with light strips
    const wallMat = new THREE.MeshStandardMaterial({ color: '#0b0d12', roughness: 0.6, metalness: 0.5, side: THREE.BackSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 14, 64, 1, true), wallMat);
    wall.position.y = 7;
    s.add(wall);
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dfe9ff').multiplyScalar(1.3), toneMapped: false });
    const accentMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2d95').multiplyScalar(2.5), toneMapped: false });
    const stripGeo = new THREE.BoxGeometry(0.12, 9, 0.12);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const m = new THREE.Mesh(stripGeo, i % 7 === 3 ? accentMat : stripMat);
      m.position.set(Math.cos(a) * 23.7, 5.5, Math.sin(a) * 23.7);
      s.add(m);
    }
    // ceiling light panels
    const ceilMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(0.8), toneMapped: false, side: THREE.DoubleSide });
    for (let i = -2; i <= 2; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 14), ceilMat);
      p.rotation.x = Math.PI / 2;
      p.position.set(i * 2.2, 9, 0);
      s.add(p);
    }
    const ceilRing = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.06, 6, 96), ceilMat);
    ceilRing.rotation.x = Math.PI / 2;
    ceilRing.position.y = 8.9;
    s.add(ceilRing);

    // ---- lights
    s.add(new THREE.HemisphereLight('#b8c8ff', '#0a0a0f', 0.2));
    const key = new THREE.SpotLight('#ffffff', 140, 40, 0.5, 0.6, 1.6);
    key.position.set(5, 9, 6);
    key.target.position.set(0, 0.5, 0);
    key.castShadow = cfg.shadows;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    key.shadow.radius = 4;
    s.add(key, key.target);
    const rim = new THREE.SpotLight('#9fd8ff', 90, 40, 0.6, 0.7, 1.6);
    rim.position.set(-6, 6, -7);
    rim.target.position.set(0, 0.6, 0);
    s.add(rim, rim.target);
    const magenta = new THREE.PointLight('#ff2d95', 10, 14, 1.8);
    magenta.position.set(-6, 1.5, 5);
    s.add(magenta);
    const cyan = new THREE.PointLight('#29e8ff', 10, 14, 1.8);
    cyan.position.set(6, 1.2, -5);
    s.add(cyan);
    const area = new THREE.RectAreaLight('#ffffff', 2.2, 10, 2.4);
    area.position.set(0, 7.5, 0);
    area.lookAt(0, 0, 0);
    s.add(area);
    const area2 = new THREE.RectAreaLight('#dfe8ff', 1.2, 8, 3);
    area2.position.set(0, 3, 9);
    area2.lookAt(0, 0.6, 0);
    s.add(area2);

    // ---- volumetric light shafts
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#cfe4ff') }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
        void main(){ float a = pow(vUv.y, 1.6) * 0.035 * (0.85 + 0.15 * sin(uTime * 0.7 + vUv.x * 12.0)); a *= smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
        gl_FragColor = vec4(uColor * a, a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    for (const [x, z] of [[-2.2, 0.5], [2.2, -0.5], [0, 0]]) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2.8, 9, 24, 1, true), shaftMat);
      cone.position.set(x, 4.5, z);
      s.add(cone);
      this.shafts.push(cone);
    }

    // ---- floating dust
    const rng = new Rng(3);
    const N = Math.round(500 * cfg.particles);
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rng.range(-12, 12);
      pos[i * 3 + 1] = rng.range(0, 9);
      pos[i * 3 + 2] = rng.range(-12, 12);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({ size: 0.05, map: glowSprite(), color: '#9fc8ff', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    s.add(this.dust);

    this.camera.position.set(6, 2, 6);
    this.camera.lookAt(this.lookTarget);
  }

  /** Display a car on the turntable with a rise/sink transition. */
  showCar(carId: string, look: CarLook, immediate = false): void {
    const spec = getVehicle(carId);
    if (this.car && this.car.spec.id === carId) {
      this.car.setLook(look);
      return;
    }
    if (this.outgoing) {
      this.outgoing.dispose();
      this.outgoing = null;
    }
    if (this.car && !immediate) {
      this.outgoing = this.car;
      this.outgoingT = 0;
    } else if (this.car) {
      this.car.dispose();
    }
    const car = new CarModel(spec, look, { lod: 'high', interior: true, shadows: this.ctx.config.shadows });
    car.position.y = 0.12;
    this.turntable.add(car);
    this.car = car;
    this.incomingT = immediate ? 1 : 0;
    this.carTransform = 0;
  }

  setLook(look: Partial<CarLook>): void {
    this.car?.setLook(look);
  }

  get currentCar(): CarModel | null {
    return this.car;
  }

  setMode(mode: ShowroomMode): void {
    this.mode = mode;
    if (mode === 'garage') {
      this.targetDist = 7.2;
      this.targetPitch = 0.16;
    }
  }

  attachControls(el: HTMLElement): void {
    this.detachControls();
    const down = (e: PointerEvent) => {
      if (this.mode !== 'garage') return;
      if ((e.target as HTMLElement) !== el) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.idleTimer = 0;
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.targetYaw -= dx * 0.006;
      this.targetPitch = clamp(this.targetPitch + dy * 0.004, 0.02, 0.85);
      this.idleTimer = 0;
    };
    const up = () => (this.dragging = false);
    const wheel = (e: WheelEvent) => {
      if (this.mode !== 'garage') return;
      this.targetDist = clamp(this.targetDist + Math.sign(e.deltaY) * 0.6, 4.2, 12);
      this.idleTimer = 0;
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: true });
    this.detachFns.push(() => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
    });
  }

  detachControls(): void {
    for (const f of this.detachFns) f();
    this.detachFns = [];
  }

  /** Directly set the garage orbit (used by photo/preview mode). */
  setOrbit(yaw: number, pitch: number, dist: number): void {
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    this.dist = this.targetDist = dist;
    this.idleTimer = -1e9;
  }

  zoom(delta: number): void {
    this.targetDist = clamp(this.targetDist + delta, 4.2, 12);
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    // car swap animation
    if (this.outgoing) {
      this.outgoingT += dt * 2.6;
      const k = smoothstep(0, 1, this.outgoingT);
      this.outgoing.position.y = 0.12 - k * 2.2;
      this.outgoing.scale.setScalar(1 - k * 0.05);
      if (this.outgoingT >= 1) {
        this.outgoing.dispose();
        this.outgoing = null;
      }
    }
    if (this.car) {
      if (this.incomingT < 1) this.incomingT = Math.min(1, this.incomingT + dt * (this.outgoing ? 0.5 : 1.8));
      const k = this.outgoing ? 0 : smoothstep(0, 1, this.incomingT);
      this.car.position.y = 0.12 - (1 - k) * 2.2;
      this.car.visible = !this.outgoing;
      this.carTransform = damp(this.carTransform, this.carTransformTarget, 2.2, dt);
      const p = this.carTransform;
      const ride = p * p * (3 - 2 * p) * this.car.spec.physics.hoverHeight + (p > 0.5 ? Math.sin(t * 2.2) * 0.04 * p : 0);
      this.car.position.y += ride;
      this.car.update(dt, {
        transform: p,
        speed: 0,
        steerAngle: Math.sin(t * 0.4) * 0.25 * (this.mode === 'menu' ? 1 : 0),
        bodyPitch: 0,
        bodyRoll: 0,
        bounce: 0,
        nitro: false,
        throttle: p > 0.5 ? 0.3 + 0.2 * Math.sin(t * 3) : 0,
        brake: 0,
        ride: ride + 0.12,
      });
    }
    const ringPulse = 1.3 + Math.sin(t * 2) * 0.35 + (this.incomingT < 1 ? 4 * (1 - this.incomingT) : 0);
    this.ringMat.color.set('#29e8ff').multiplyScalar(ringPulse);
    for (const sh of this.shafts) ((sh.material as THREE.ShaderMaterial).uniforms.uTime.value = t);
    // dust drift
    const dp = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < dp.count; i++) {
      let y = dp.getY(i) + dt * 0.08;
      if (y > 9) y = 0;
      dp.setY(i, y);
      dp.setX(i, dp.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.03);
    }
    dp.needsUpdate = true;

    // turntable & camera choreography
    if (this.mode === 'menu') {
      this.turntable.rotation.y += dt * this.turntableSpeed;
      // cinematic orbit with slow "shots"
      const shot = Math.floor(t / 9) % 3;
      const st = (t % 9) / 9;
      let yaw = t * 0.07;
      let pitch = 0.16;
      let dist = 8.5;
      let ty = 0.55;
      if (shot === 1) {
        pitch = lerp(0.05, 0.12, st);
        dist = lerp(6.2, 5.6, st);
        ty = 0.45;
      } else if (shot === 2) {
        pitch = lerp(0.42, 0.3, st);
        dist = lerp(9.5, 8.6, st);
      }
      this.yaw = damp(this.yaw, yaw + 0.9, 0.6, dt);
      this.pitch = damp(this.pitch, pitch, 0.5, dt);
      this.dist = damp(this.dist, dist, 0.5, dt);
      this.lookTarget.y = damp(this.lookTarget.y, ty, 0.6, dt);
      this.lookTarget.x = damp(this.lookTarget.x, 1.6, 0.8, dt);
    } else {
      this.idleTimer += dt;
      if (!this.dragging && this.idleTimer > 4) this.targetYaw += dt * 0.12;
      this.turntable.rotation.y = damp(this.turntable.rotation.y, Math.round(this.turntable.rotation.y / (Math.PI * 2)) * Math.PI * 2, 1.2, dt);
      this.yaw = damp(this.yaw, this.targetYaw, 6, dt);
      this.pitch = damp(this.pitch, this.targetPitch, 6, dt);
      this.dist = damp(this.dist, this.targetDist, 5, dt);
      this.lookTarget.y = damp(this.lookTarget.y, 0.6, 3, dt);
      // shift the car left of the UI panel (panel is on the right side)
      this.lookTarget.x = damp(this.lookTarget.x, this.mode === 'garage' ? -1.4 : 0, 3, dt);
    }
    const cp = Math.cos(this.pitch);
    // camera orbits the car; offset the target sideways in camera space so the car sits off-center
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const center = new THREE.Vector3(0, this.lookTarget.y, 0).addScaledVector(right, -this.lookTarget.x * 0.6);
    this.camera.position.set(center.x + Math.sin(this.yaw) * cp * this.dist, center.y + Math.sin(this.pitch) * this.dist + 0.2, center.z + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(center);
  }

  dispose(): void {
    this.detachControls();
    this.car?.dispose();
    this.outgoing?.dispose();
    this.envTex.dispose();
    this.reflector?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Points).isPoints) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
  }
}
