import * as THREE from 'three';
import type { Track, TrackPath, TrackSample } from '../Track';
import { neonSignAtlas } from '../../graphics/TextureFactory';

export interface Scenery {
  group: THREE.Group;
  update(dt: number, time: number, camera: THREE.Camera): void;
  dispose(): void;
}

/** Uniform grid over track samples for fast "distance to road" queries. */
export class TrackSpatialIndex {
  private cells = new Map<string, { path: TrackPath; i: number }[]>();
  readonly bounds = new THREE.Box3();
  constructor(
    track: Track,
    private readonly cell = 40,
  ) {
    for (const p of track.paths) {
      for (let i = 0; i < p.count; i += 2) {
        const s = p.samples[i];
        this.bounds.expandByPoint(s.pos);
        const k = this.key(s.pos.x, s.pos.z);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push({ path: p, i });
      }
    }
  }
  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }
  /** Nearest sample within radius (horizontal distance). */
  nearest(x: number, z: number, radius: number): { d: number; sample: TrackSample; path: TrackPath } | null {
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best: { d: number; sample: TrackSample; path: TrackPath } | null = null;
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        const arr = this.cells.get(`${cx + i},${cz + j}`);
        if (!arr) continue;
        for (const e of arr) {
          const s = e.path.samples[e.i];
          const d = Math.hypot(s.pos.x - x, s.pos.z - z);
          if (d <= radius && (!best || d < best.d)) best = { d, sample: s, path: e.path };
        }
      }
    return best;
  }
  /** Clearance from the road edge (negative = on the road). */
  clearance(x: number, z: number, radius = 200): number {
    const n = this.nearest(x, z, radius);
    if (!n) return radius;
    return n.d - n.sample.width / 2;
  }
}

/**
 * Building material: standard PBR with procedural lit windows computed from the
 * instance-scaled local position (no textures, any building size).
 */
export function buildingMaterial(opts: {
  color: string;
  roughness: number;
  metalness: number;
  windowIntensity: number;
  litFraction: number;
  warm?: string;
  cool?: string;
  cell?: [number, number];
  accent?: string;
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: opts.color, roughness: opts.roughness, metalness: opts.metalness });
  const uniforms = {
    uWin: { value: opts.windowIntensity },
    uLit: { value: 1 - opts.litFraction },
    uWarm: { value: new THREE.Color(opts.warm ?? '#ffc27a') },
    uCool: { value: new THREE.Color(opts.cool ?? '#9fd8ff') },
    uCell: { value: new THREE.Vector2(...(opts.cell ?? [3.2, 3.8])) },
    uAccent: { value: new THREE.Color(opts.accent ?? '#000000') },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBPos; varying vec3 vBNrm; varying float vBSeed;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        mat4 bim = mat4(1.0);
        #ifdef USE_INSTANCING
          bim = instanceMatrix;
        #endif
        vec3 bsc = vec3(length(bim[0].xyz), length(bim[1].xyz), length(bim[2].xyz));
        vBPos = position * bsc;
        vBNrm = normal;
        vBSeed = fract(sin(dot(bim[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBPos; varying vec3 vBNrm; varying float vBSeed;
        uniform float uWin; uniform float uLit; uniform vec3 uWarm; uniform vec3 uCool; uniform vec2 uCell; uniform vec3 uAccent;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 bn = normalize(vBNrm);
          float side = 1.0 - step(0.5, abs(bn.y));
          vec2 fc = abs(bn.x) > 0.5 ? vBPos.zy : vBPos.xy;
          vec2 id = floor(fc / uCell);
          vec2 f = fract(fc / uCell);
          float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.24, f.y) * step(f.y, 0.8);
          float rnd = fract(sin(dot(id + vBSeed * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
          float lit = step(uLit, rnd);
          vec3 wc = mix(uWarm, uCool, step(0.55, fract(rnd * 7.13)));
          float podium = step(4.0, vBPos.y);
          totalEmissiveRadiance += win * lit * wc * uWin * side * podium * (0.45 + 0.55 * fract(rnd * 13.7));
          // accent light bands every ~40 m
          float band = smoothstep(0.08, 0.0, abs(fract(vBPos.y / 42.0 + vBSeed) - 0.5) - 0.47);
          totalEmissiveRadiance += uAccent * band * side * 2.0;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `bld-${opts.windowIntensity}-${opts.litFraction}-${opts.accent ?? ''}`;
  return mat;
}

/** Instanced neon signs sampling a shared atlas, with per-sign flicker. */
export function neonSignMesh(items: { matrix: THREE.Matrix4; cell: number; seed: number }[]): THREE.InstancedMesh {
  const atlas = neonSignAtlas();
  const geo = new THREE.PlaneGeometry(1, 1);
  const cells = new Float32Array(items.length * 2);
  const seeds = new Float32Array(items.length);
  items.forEach((it, i) => {
    cells[i * 2] = it.cell % atlas.cols;
    cells[i * 2 + 1] = Math.floor(it.cell / atlas.cols) % atlas.rows;
    seeds[i] = it.seed;
  });
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: atlas.texture }, uTime: { value: 0 }, uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) }, uIntensity: { value: 2.4 } },
    vertexShader: /* glsl */ `
      attribute vec2 aCell; attribute float aSeed;
      varying vec2 vUv; varying float vSeed; varying float vDist;
      uniform vec2 uGrid;
      void main() {
        vUv = (vec2(aCell.x, uGrid.y - 1.0 - aCell.y) + uv) / uGrid;
        vSeed = aSeed;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uTime; uniform float uIntensity;
      varying vec2 vUv; varying float vSeed; varying float vDist;
      void main() {
        vec3 c = texture2D(uMap, vUv).rgb;
        float t = uTime * (0.6 + vSeed);
        float flick = step(0.04, fract(sin(floor(t * 9.0 + vSeed * 50.0)) * 4375.85)) * 0.35 + 0.65;
        flick = mix(1.0, flick, step(0.75, vSeed));
        float fade = 1.0 - smoothstep(600.0, 1600.0, vDist);
        gl_FragColor = vec4(c * uIntensity * flick * fade, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => mesh.setMatrixAt(i, it.matrix));
  mesh.frustumCulled = false;
  return mesh;
}

export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], opts: { cast?: boolean; receive?: boolean } = {}): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  matrices.forEach((x, i) => m.setMatrixAt(i, x));
  m.count = matrices.length;
  m.castShadow = !!opts.cast;
  m.receiveShadow = !!opts.receive;
  m.computeBoundingSphere();
  return m;
}

export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) {
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
  });
}

const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
export function trs(x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _s);
}

/** Street-lamp style light pools: additive glowing decals lying on the road. */
export function lightPoolMaterial(color: string, strength = 0.6): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying float vDist;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uStrength; varying vec2 vUv; varying float vDist;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2) * uStrength * (1.0 - smoothstep(300.0, 900.0, vDist));
      gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    toneMapped: false,
  });
}
