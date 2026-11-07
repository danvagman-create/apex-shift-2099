import * as THREE from 'three';
import { glowSprite, smokeSprite } from './TextureFactory';

export interface ParticleOptions {
  max: number;
  texture: 'glow' | 'smoke';
  additive: boolean;
  gravity: number;
  drag: number;
}

/** CPU-simulated particle pool rendered as a single Points draw call. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private growth: Float32Array;
  private alpha0: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;
  private active = 0;

  constructor(private readonly opts: ParticleOptions) {
    const n = opts.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.growth = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: opts.texture === 'glow' ? glowSprite() : smokeSprite() }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vColor.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor.rgb * t.rgb * ${opts.additive ? 'a' : '1.0'}, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !opts.additive,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  setScale(viewportHeight: number, fovDeg: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, color: THREE.Color, alpha: number, growth = 0): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.opts.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.col[i * 4] = color.r;
    this.col[i * 4 + 1] = color.g;
    this.col[i * 4 + 2] = color.b;
    this.col[i * 4 + 3] = alpha;
    this.alpha0[i] = alpha;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.growth[i] = growth;
    this.active = Math.min(this.opts.max, this.active + 1);
  }

  update(dt: number): void {
    const n = this.opts.max;
    const g = this.opts.gravity;
    const drag = Math.exp(-this.opts.drag * dt);
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= g * dt;
      this.vel[k] *= drag;
      this.vel[k + 1] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.growth[i] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[i * 4 + 3] = this.alpha0[i] * f * (this.opts.additive ? 1 : Math.min(1, (1 - f) * 6));
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/**
 * Camera-attached motion streaks; all animation on the GPU.
 * Intensity scales with speed so 400 km/h reads dramatically faster than 100 km/h.
 */
export class SpeedLines {
  readonly mesh: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;
  private time = 0;
  constructor(count: number) {
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.2 + Math.pow(Math.random(), 0.7) * 9;
      const ph = Math.random();
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        seed[j * 3] = a;
        seed[j * 3 + 1] = r;
        seed[j * 3 + 2] = ph;
        end[j] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSpeed: { value: 0 }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color('#cfe9ff') } },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed; attribute float aEnd; uniform float uTime; uniform float uSpeed; uniform float uIntensity;
        varying float vA;
        void main() {
          float L = 90.0;
          float z = -mod(aSeed.z * L + uTime * uSpeed * 1.4, L) - 3.0;
          float len = 1.5 + uSpeed * 0.09;
          z -= aEnd * len;
          vec3 p = vec3(cos(aSeed.x) * aSeed.y, sin(aSeed.x) * aSeed.y * 0.62, z);
          vA = uIntensity * (1.0 - aEnd) * smoothstep(-90.0, -20.0, z) * smoothstep(-2.0, -8.0, z) * smoothstep(2.0, 4.0, aSeed.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }
  update(dt: number, speed: number, nitro: boolean, color?: THREE.Color): void {
    this.time += dt;
    const u = this.mat.uniforms;
    u.uTime.value = this.time;
    u.uSpeed.value = speed;
    const k = Math.max(0, (speed - 45) / 70);
    u.uIntensity.value = Math.min(0.75, k * k * 0.45 + (nitro ? 0.25 : 0));
    if (color) (u.uColor.value as THREE.Color).copy(color);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Rain streaks around the camera (world-space, wrapped in a box that follows the camera). */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;
  private time = 0;
  constructor(count: number) {
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        seed.set(s, j * 3);
        end[j] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed; attribute float aEnd; uniform float uTime; uniform vec3 uCam; uniform vec3 uVel; varying float vA;
        void main() {
          vec3 box = vec3(60.0, 40.0, 60.0);
          vec3 fall = vec3(0.0, -22.0, 0.0);
          vec3 p = aSeed * box + fall * uTime;
          p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          vec3 streak = (fall - uVel) * 0.035;
          p += streak * aEnd;
          float d = length(p - uCam);
          vA = (1.0 - smoothstep(10.0, 30.0, d)) * 0.35 * (1.0 - aEnd * 0.8);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `varying float vA; void main(){ gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * vA, vA); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
  }
  update(dt: number, camPos: THREE.Vector3, carVel: THREE.Vector3): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    (this.mat.uniforms.uCam.value as THREE.Vector3).copy(camPos);
    (this.mat.uniforms.uVel.value as THREE.Vector3).copy(carVel);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
