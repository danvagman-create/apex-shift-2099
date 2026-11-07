import * as THREE from 'three';
import { mod } from '../core/utils';
import type { GraphicsConfig } from '../core/Settings';
import { Track, TrackPath, TrackProjection, type TrackSample } from './Track';
import { F_BRIDGE, F_ELEVATED, F_TUNNEL } from './TrackLayout';
import { billboardTexture, checkerTexture, hexTexture, noiseNormal, roadMarkings, roadRoughness, roadTexture, rockTexture } from '../graphics/TextureFactory';

export interface ProfilePt {
  edge: -1 | 0 | 1; // anchor: left edge, center, right edge
  off: number; // additional lateral offset (m)
  h: number; // height along up (m)
  u: number; // texture u
}

export interface TrackTheme {
  edgeColor: string;
  edgeColor2: string;
  curbA: string;
  curbB: string;
  wall: 'concrete' | 'guardrail' | 'energy';
  wallColor: string;
  wallGlow: string;
  slabColor: string;
  tunnel: 'city' | 'rock';
  roadRoughness: number;
  roadMetalness: number;
}

export const THEMES: Record<string, TrackTheme> = {
  tokyo: { edgeColor: '#ff2d95', edgeColor2: '#29e8ff', curbA: '#e8e8ec', curbB: '#d0103a', wall: 'concrete', wallColor: '#5b5f68', wallGlow: '#ff2d95', slabColor: '#2c2f36', tunnel: 'city', roadRoughness: 1, roadMetalness: 0.05 },
  canyon: { edgeColor: '#ff7a1a', edgeColor2: '#ffd04a', curbA: '#f2efe8', curbB: '#e0401a', wall: 'guardrail', wallColor: '#9aa0a8', wallGlow: '#ff7a1a', slabColor: '#4a4038', tunnel: 'rock', roadRoughness: 1, roadMetalness: 0.0 },
  skyline: { edgeColor: '#29e8ff', edgeColor2: '#b18cff', curbA: '#e8f6ff', curbB: '#1a6dff', wall: 'energy', wallColor: '#29e8ff', wallGlow: '#29e8ff', slabColor: '#1d2230', tunnel: 'city', roadRoughness: 1, roadMetalness: 0.2 },
};

/** Contiguous index runs of samples satisfying a predicate (wrap-aware for closed paths). */
export function runs(path: TrackPath, pred: (i: number, s: TrackSample) => boolean): [number, number][] {
  const n = path.count;
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const ok = pred(i, path.samples[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, n - 1]);
  if (path.closed && out.length > 1 && out[0][0] === 0 && out[out.length - 1][1] === n - 1) {
    const last = out.pop()!;
    out[0] = [last[0], out[0][1] + n];
  } else if (path.closed && out.length === 1 && out[0][0] === 0 && out[0][1] === n - 1) {
    out[0] = [0, n]; // whole loop, close it
  }
  return out;
}

const _p = new THREE.Vector3();

/** Sweep a cross-section profile along sample runs. */
export function sweep(path: TrackPath, profile: ProfilePt[], ranges: [number, number][], vScale: number, widthOverride?: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = path.count;
  const P = profile.length;
  for (const [a, b] of ranges) {
    const base = pos.length / 3;
    let vAcc = path.samples[mod(a, n)].s;
    for (let k = a; k <= b; k++) {
      const i = path.closed ? mod(k, n) : Math.min(k, n - 1);
      const smp = path.samples[i];
      if (k > a) vAcc += path.spacing;
      const half = (widthOverride ?? smp.width) / 2;
      for (const pt of profile) {
        const lat = pt.edge * half + pt.off;
        _p.copy(smp.pos).addScaledVector(smp.right, lat).addScaledVector(smp.up, pt.h);
        pos.push(_p.x, _p.y, _p.z);
        uv.push(pt.u, vAcc / vScale);
      }
      if (k > a) {
        const r0 = base + (k - a - 1) * P;
        const r1 = base + (k - a) * P;
        for (let j = 0; j < P - 1; j++) idx.push(r0 + j, r0 + j + 1, r1 + j, r0 + j + 1, r1 + j + 1, r1 + j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Animated scrolling chevrons (hover lanes / hover rails). */
export function chevronMaterial(color: string, opacity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vFog;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying float vFog;
      void main() {
        float x = abs(vUv.x - 0.5) * 2.0;
        float v = fract(vUv.y * 1.0 - uTime * 2.2 + x * 0.35);
        float chev = smoothstep(0.0, 0.08, v) * smoothstep(0.42, 0.3, v);
        float edge = smoothstep(0.82, 0.95, x);
        float a = (chev * 0.75 + edge) * (1.0 - smoothstep(0.98, 1.0, x));
        a *= uOpacity * (1.0 - smoothstep(250.0, 900.0, vFog));
        gl_FragColor = vec4(uColor * a * 2.2, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Translucent energy barrier with hex pattern and bright top edge. */
export function energyWallMaterial(color: string): THREE.ShaderMaterial {
  const hex = hexTexture();
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uHex: { value: hex } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vDist;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform sampler2D uHex; varying vec2 vUv; varying float vDist;
      void main() {
        float h = vUv.x;
        float hexv = texture2D(uHex, vec2(vUv.y * 0.6, h * 0.5)).r;
        float top = smoothstep(0.86, 1.0, h);
        float scan = smoothstep(0.0, 0.02, fract(vUv.y * 0.05 - uTime * 0.4)) * smoothstep(0.06, 0.02, fract(vUv.y * 0.05 - uTime * 0.4));
        float a = hexv * 0.16 * (1.0 - h * 0.5) + top * 0.9 + scan * 0.25 + 0.04;
        a *= 1.0 - smoothstep(300.0, 1200.0, vDist);
        gl_FragColor = vec4(uColor * a * 1.6, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export interface TrackVisuals {
  group: THREE.Group;
  animated: THREE.ShaderMaterial[];
  dispose(): void;
}

/** Build all track-surface related meshes for a circuit. */
export function buildTrackMeshes(track: Track, themeName: string, cfg: GraphicsConfig): TrackVisuals {
  const theme = THEMES[themeName];
  const group = new THREE.Group();
  group.name = 'track';
  const animated: THREE.ShaderMaterial[] = [];
  const disposables: { dispose(): void }[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Material, opts: { shadow?: boolean; order?: number } = {}) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = !!opts.shadow;
    if (opts.order !== undefined) mesh.renderOrder = opts.order;
    group.add(mesh);
    disposables.push(g, m);
    return mesh;
  };
  const main = track.main;
  const W = track.def.wallHeight;

  // ---------------------------------------------------------------- road surface
  const roadMap = roadTexture(themeName);
  roadMap.anisotropy = cfg.anisotropy;
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadMap,
    roughnessMap: roadRoughness(themeName),
    roughness: theme.roadRoughness,
    metalness: theme.roadMetalness,
    normalMap: noiseNormal('asphalt', 256, 1.6, 8, 1),
    normalScale: new THREE.Vector2(0.18, 0.18),
    envMapIntensity: themeName === 'tokyo' ? 0.75 : 0.45,
    emissive: '#ffffff',
    emissiveMap: roadMarkings(themeName),
    emissiveIntensity: themeName === 'tokyo' ? 0.32 : 0.08,
  });
  const roadGeo = sweepFraction(main, 6, 24);
  add(roadGeo, roadMat, { shadow: true });

  // lane dashes as real geometry (texture dashes vanish at grazing angles due to mipmapping)
  const lanes = themeName === 'canyon' ? 3 : 4;
  const dashMat = new THREE.MeshStandardMaterial({
    color: themeName === 'canyon' ? '#f3e2c8' : '#eef3ff',
    roughness: 0.5,
    emissive: themeName === 'skyline' ? '#7fe9ff' : '#ffffff',
    emissiveIntensity: themeName === 'tokyo' ? 0.55 : themeName === 'skyline' ? 0.6 : 0.12,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  add(laneDashes(main, lanes, 4, 12), dashMat, { shadow: true });

  // shoulders (dark strips outside edges up to the walls)
  const shoulderMat = new THREE.MeshStandardMaterial({ color: theme.slabColor, roughness: 0.85, metalness: 0.1 });
  for (const side of [-1, 1] as const) {
    const prof: ProfilePt[] = side < 0 ? [{ edge: -1, off: -0.8, h: 0.0, u: 0 }, { edge: -1, off: 0, h: 0.0, u: 1 }] : [{ edge: 1, off: 0, h: 0.0, u: 0 }, { edge: 1, off: 0.8, h: 0.0, u: 1 }];
    add(sweep(main, prof, runs(main, () => true), 10), shoulderMat, { shadow: true });
  }

  // glowing edge lines
  const edgeMat1 = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.edgeColor).multiplyScalar(2.2), toneMapped: false });
  const edgeMat2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.edgeColor2).multiplyScalar(2.2), toneMapped: false });
  for (const side of [-1, 1] as const) {
    const prof: ProfilePt[] = side < 0 ? [{ edge: -1, off: 0.2, h: 0.02, u: 0 }, { edge: -1, off: 0.32, h: 0.02, u: 1 }] : [{ edge: 1, off: -0.32, h: 0.02, u: 0 }, { edge: 1, off: -0.2, h: 0.02, u: 1 }];
    add(sweep(main, prof, runs(main, () => true), 10), side < 0 ? edgeMat1 : edgeMat2);
  }

  // curbs at corners
  const curbTex = curbTexture(theme.curbA, theme.curbB);
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.5, metalness: 0.1 });
  disposables.push(curbTex);
  for (const side of [-1, 1] as const) {
    const corner = runs(main, (_i, s) => Math.abs(s.curvature) > 1 / 260 && (s.curvature > 0 ? side < 0 : side > 0));
    const prof: ProfilePt[] = side < 0 ? [{ edge: -1, off: 0.0, h: 0.04, u: 0 }, { edge: -1, off: 1.3, h: 0.08, u: 1 }] : [{ edge: 1, off: -1.3, h: 0.08, u: 0 }, { edge: 1, off: 0.0, h: 0.04, u: 1 }];
    if (corner.length) add(sweep(main, prof, corner, 4), curbMat, { shadow: true });
  }

  // ---------------------------------------------------------------- walls
  buildWalls(main, theme, W, add, animated);
  for (const b of track.branches) buildWalls(b, theme, W, add, animated, true);

  // ---------------------------------------------------------------- slab underside (elevated)
  const slabMat = new THREE.MeshStandardMaterial({ color: theme.slabColor, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  const allSlab = themeName === 'skyline';
  const slabRuns = runs(main, (_i, s) => allSlab || (s.flags & (F_ELEVATED | F_BRIDGE)) !== 0);
  if (slabRuns.length) {
    const depth = allSlab ? 2.4 : 1.4;
    const prof: ProfilePt[] = [
      { edge: -1, off: -1.4, h: 0, u: 0 },
      { edge: -1, off: -1.4, h: -depth * 0.6, u: 0.2 },
      { edge: -1, off: 1.5, h: -depth, u: 0.4 },
      { edge: 1, off: -1.5, h: -depth, u: 0.6 },
      { edge: 1, off: 1.4, h: -depth * 0.6, u: 0.8 },
      { edge: 1, off: 1.4, h: 0, u: 1 },
    ];
    add(sweep(main, prof, slabRuns, 10), slabMat);
    // underside light strips
    const ul = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.edgeColor2).multiplyScalar(1.6), toneMapped: false, side: THREE.DoubleSide });
    for (const side of [-1, 1] as const) {
      add(sweep(main, [{ edge: side, off: -side * 1.2, h: -depth * 0.6 - 0.02, u: 0 }, { edge: side, off: -side * 1.6, h: -depth * 0.62 - 0.02, u: 1 }], slabRuns, 10), ul);
    }
  }

  // ---------------------------------------------------------------- tunnels
  const tunnelRuns = runs(main, (_i, s) => (s.flags & F_TUNNEL) !== 0);
  if (tunnelRuns.length) {
    const H = 8;
    const prof: ProfilePt[] = [
      { edge: 1, off: 1.6, h: -0.2, u: 0 },
      { edge: 1, off: 1.6, h: H * 0.55, u: 0.18 },
      { edge: 1, off: -1.5, h: H, u: 0.35 },
      { edge: -1, off: 1.5, h: H, u: 0.65 },
      { edge: -1, off: -1.6, h: H * 0.55, u: 0.82 },
      { edge: -1, off: -1.6, h: -0.2, u: 1 },
    ];
    const tunnelMat =
      theme.tunnel === 'rock'
        ? new THREE.MeshStandardMaterial({ map: rockTexture(), roughness: 0.95, metalness: 0, side: THREE.DoubleSide, color: '#b08070' })
        : new THREE.MeshStandardMaterial({ color: '#3a3d45', roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide });
    add(sweep(main, prof, tunnelRuns, 12), tunnelMat, { shadow: true });
    // continuous ceiling light strips + periodic light bars for strong speed sensation
    const lightCol = theme.tunnel === 'rock' ? '#ffb060' : '#e8f2ff';
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(lightCol).multiplyScalar(1.1), toneMapped: false, side: THREE.DoubleSide });
    for (const side of [-1, 1] as const) {
      add(sweep(main, [{ edge: side, off: -side * 3.4, h: H - 0.05, u: 0 }, { edge: side, off: -side * 3.0, h: H - 0.05, u: 1 }], tunnelRuns, 10), stripMat);
    }
    const barGeo = new THREE.BoxGeometry(1, 0.12, 0.5);
    const bars: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const basis = new THREE.Matrix4();
    for (const [a, b] of tunnelRuns) {
      for (let k = a; k <= b; k += 6) {
        const smp = main.samples[mod(k, main.count)];
        basis.makeBasis(smp.right, smp.up, smp.tangent);
        q.setFromRotationMatrix(basis);
        m4.compose(_p.copy(smp.pos).addScaledVector(smp.up, H - 0.1), q, new THREE.Vector3(smp.width * 0.55, 1, 1));
        bars.push(m4.clone());
      }
    }
    const inst = new THREE.InstancedMesh(barGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.tunnel === 'rock' ? '#ff9a40' : '#bfe6ff').multiplyScalar(1.3), toneMapped: false }), bars.length);
    bars.forEach((m, i) => inst.setMatrixAt(i, m));
    group.add(inst);
    disposables.push(barGeo, inst.material as THREE.Material);
    // portals
    const portalMat = new THREE.MeshStandardMaterial({ color: theme.tunnel === 'rock' ? '#6a3a26' : '#24272e', roughness: 0.6, metalness: 0.5 });
    for (const [a, b] of tunnelRuns) {
      for (const k of [a, b]) {
        const smp = main.samples[mod(k, main.count)];
        const frame = new THREE.Mesh(new THREE.BoxGeometry(smp.width + 8, 2.2, 1.6), portalMat);
        basis.makeBasis(smp.right, smp.up, smp.tangent);
        frame.quaternion.setFromRotationMatrix(basis);
        frame.position.copy(smp.pos).addScaledVector(smp.up, H + 1);
        group.add(frame);
        disposables.push(frame.geometry);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(smp.width + 2, 0.15, 1.65), edgeMat1);
        glow.quaternion.copy(frame.quaternion);
        glow.position.copy(smp.pos).addScaledVector(smp.up, H + 0.05);
        group.add(glow);
        disposables.push(glow.geometry);
      }
    }
    disposables.push(portalMat);
  }

  // ---------------------------------------------------------------- hover lanes
  const laneMat = chevronMaterial(themeName === 'canyon' ? '#29e8ff' : '#00ffc6', 0.9);
  animated.push(laneMat);
  const laneRuns = runs(main, (_i, s) => !isNaN(s.hoverLane));
  for (const [a, b] of laneRuns) {
    const lat = main.samples[mod(Math.floor((a + b) / 2), main.count)].hoverLane;
    const g = sweep(main, [{ edge: 0, off: lat - 2.6, h: 0.03, u: 0 }, { edge: 0, off: lat + 2.6, h: 0.03, u: 1 }], [[a, b]], 9);
    add(g, laneMat, { order: 1 });
  }

  // ---------------------------------------------------------------- branches (hover rails)
  const railMat = chevronMaterial('#29e8ff', 0.75);
  animated.push(railMat);
  for (const b of track.branches) {
    const all = runs(b, () => true);
    add(sweep(b, [{ edge: -1, off: 0, h: 0.02, u: 0 }, { edge: 1, off: 0, h: 0.02, u: 1 }], all, 8), railMat, { order: 1 });
    // translucent floor
    const floorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0a3a55'), transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    add(sweep(b, [{ edge: -1, off: 0, h: 0.0, u: 0 }, { edge: 1, off: 0, h: 0.0, u: 1 }], all, 8), floorMat);
    // ring gates
    const ringGeo = new THREE.TorusGeometry(b.samples[0].width / 2 + 1.5, 0.18, 6, 40, Math.PI);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#29e8ff').multiplyScalar(2.5), toneMapped: false });
    const count = Math.floor(b.count / 18);
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, count);
    const basis = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let k = 0; k < count; k++) {
      const smp = b.samples[Math.min(b.count - 1, 6 + k * 18)];
      basis.makeBasis(smp.right, smp.up, smp.tangent);
      q.setFromRotationMatrix(basis);
      rings.setMatrixAt(k, new THREE.Matrix4().compose(smp.pos, q, new THREE.Vector3(1, 1, 1)));
    }
    group.add(rings);
    disposables.push(ringGeo, ringMat);
    // "HOVER ONLY" sign at entry
    const signTex = billboardTexture(['HOVER', 'ONLY // SHIFT'], '#29e8ff');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false, side: THREE.DoubleSide }));
    const s0 = b.samples[Math.min(b.count - 1, 22)];
    sign.position.copy(s0.pos).addScaledVector(s0.up, 7.5);
    sign.lookAt(_p.copy(s0.pos).addScaledVector(s0.tangent, -50).addScaledVector(s0.up, 7.5));
    group.add(sign);
    disposables.push(sign.geometry, sign.material as THREE.Material);
  }

  // ---------------------------------------------------------------- start / finish
  const s0 = main.samples[0];
  const check = new THREE.Mesh(
    new THREE.PlaneGeometry(s0.width, 3),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  const basis = new THREE.Matrix4().makeBasis(s0.right, s0.tangent.clone().negate(), s0.up);
  check.quaternion.setFromRotationMatrix(basis);
  check.position.copy(s0.pos).addScaledVector(s0.up, 0.025);
  check.receiveShadow = true;
  group.add(check);
  disposables.push(check.geometry, check.material as THREE.Material);
  const gantry = buildGantry(s0, theme);
  group.add(gantry);

  return {
    group,
    animated,
    dispose() {
      for (const d of disposables) d.dispose();
      gantry.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    },
  };
}

/** Dashed lane separators: quads of length `len` every `period` meters. */
function laneDashes(path: TrackPath, lanes: number, len: number, period: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const f = new TrackProjection();
  const p = new THREE.Vector3();
  const hw = 0.11;
  for (let s = 0; s < path.length - len; s += period) {
    for (let l = 1; l < lanes; l++) {
      const base = pos.length / 3;
      for (const ds of [0, len]) {
        path.frameAt(s + ds, f);
        const lat = (l / lanes - 0.5) * f.width;
        for (const o of [-hw, hw]) {
          p.copy(f.pos).addScaledVector(f.right, lat + o).addScaledVector(f.up, 0.015);
          pos.push(p.x, p.y, p.z);
          nrm.push(f.up.x, f.up.y, f.up.z);
        }
      }
      // rows: [start-left, start-right, end-left, end-right] -> faces up
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Road surface with u spanning the full width, subdivided laterally. */
function sweepFraction(path: TrackPath, sub: number, vScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = path.count;
  const count = path.closed ? n + 1 : n;
  for (let k = 0; k < count; k++) {
    const smp = path.samples[k % n];
    const v = (k * path.spacing) / vScale;
    for (let j = 0; j <= sub; j++) {
      const f = j / sub;
      const lat = (f - 0.5) * smp.width;
      _p.copy(smp.pos).addScaledVector(smp.right, lat);
      pos.push(_p.x, _p.y, _p.z);
      uv.push(f, v);
    }
    if (k > 0) {
      const r0 = (k - 1) * (sub + 1);
      const r1 = k * (sub + 1);
      for (let j = 0; j < sub; j++) idx.push(r0 + j, r0 + j + 1, r1 + j, r0 + j + 1, r1 + j + 1, r1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Normals should follow the banked up vector exactly.
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let k = 0; k < count; k++) {
    const smp = path.samples[k % n];
    for (let j = 0; j <= sub; j++) nrm.setXYZ(k * (sub + 1) + j, smp.up.x, smp.up.y, smp.up.z);
  }
  g.computeBoundingSphere();
  return g;
}

function buildWalls(
  path: TrackPath,
  theme: TrackTheme,
  H: number,
  add: (g: THREE.BufferGeometry, m: THREE.Material, o?: { shadow?: boolean; order?: number }) => THREE.Mesh,
  animated: THREE.ShaderMaterial[],
  isBranch = false,
): void {
  for (const side of [-1, 1] as const) {
    const wallArr = side < 0 ? path.wallL : path.wallR;
    const wr = runs(path, (i) => wallArr[i] === 1);
    if (!wr.length) continue;
    const o = side * 0.7;
    if (theme.wall === 'energy' || isBranch) {
      const mat = energyWallMaterial(isBranch ? '#29e8ff' : theme.wallColor);
      animated.push(mat);
      add(sweep(path, [{ edge: side, off: o, h: 0, u: 0 }, { edge: side, off: o, h: H * 1.4, u: 1 }], wr, 6), mat, { order: 2 });
      continue;
    }
    if (theme.wall === 'concrete') {
      const mat = new THREE.MeshStandardMaterial({ color: theme.wallColor, roughness: 0.8, metalness: 0.05 });
      const prof: ProfilePt[] = [
        { edge: side, off: o - side * 0.15, h: 0, u: 0 },
        { edge: side, off: o - side * 0.05, h: H * 0.3, u: 0.25 },
        { edge: side, off: o, h: H, u: 0.6 },
        { edge: side, off: o + side * 0.35, h: H, u: 0.8 },
        { edge: side, off: o + side * 0.4, h: 0, u: 1 },
      ];
      add(sweep(path, side < 0 ? [...prof].reverse() : prof, wr, 6), mat, { shadow: true });
      const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.wallGlow).multiplyScalar(2.6), toneMapped: false, side: THREE.DoubleSide });
      add(sweep(path, [{ edge: side, off: o - side * 0.01, h: H * 0.72, u: 0 }, { edge: side, off: o - side * 0.01, h: H * 0.8, u: 1 }], wr, 6), glow);
    } else {
      // guardrail: posts + rail band
      const mat = new THREE.MeshStandardMaterial({ color: theme.wallColor, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
      const prof: ProfilePt[] = [
        { edge: side, off: o, h: H * 0.35, u: 0 },
        { edge: side, off: o - side * 0.08, h: H * 0.55, u: 0.5 },
        { edge: side, off: o, h: H * 0.8, u: 1 },
      ];
      add(sweep(path, side < 0 ? [...prof].reverse() : prof, wr, 6), mat, { shadow: true });
      const backProf: ProfilePt[] = [
        { edge: side, off: o + side * 0.1, h: 0, u: 0 },
        { edge: side, off: o + side * 0.1, h: H * 0.85, u: 1 },
      ];
      add(sweep(path, side < 0 ? backProf : [...backProf].reverse(), wr, 6), new THREE.MeshStandardMaterial({ color: '#3c3a38', roughness: 0.9, side: THREE.DoubleSide }));
      const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.wallGlow).multiplyScalar(2.2), toneMapped: false, side: THREE.DoubleSide });
      add(sweep(path, [{ edge: side, off: o - side * 0.09, h: H * 0.52, u: 0 }, { edge: side, off: o - side * 0.09, h: H * 0.58, u: 1 }], wr, 6), glow);
    }
  }
}

function curbTexture(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 16, 32);
  ctx.fillStyle = b;
  ctx.fillRect(0, 32, 16, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function buildGantry(s0: TrackSample, theme: TrackTheme): THREE.Group {
  const g = new THREE.Group();
  const w = s0.width + 6;
  const mat = new THREE.MeshStandardMaterial({ color: '#1b1e25', roughness: 0.35, metalness: 0.9 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.edgeColor2).multiplyScalar(3), toneMapped: false });
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 11, 0.9), mat);
    leg.position.set((side * w) / 2, 5.5, 0);
    leg.castShadow = true;
    g.add(leg);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 10, 0.95), glow);
    strip.position.set((side * w) / 2 - side * 0.45, 5.5, 0);
    g.add(strip);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 2.4, 1.2), mat);
  beam.position.y = 11;
  beam.castShadow = true;
  g.add(beam);
  const bannerTex = billboardTexture(['APEX SHIFT', '2099 // WORLD GRAND PRIX'], theme.edgeColor2);
  for (const z of [0.62, -0.62]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, w * 0.15), new THREE.MeshBasicMaterial({ map: bannerTex, color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false }));
    banner.position.set(0, 11, z);
    if (z < 0) banner.rotation.y = Math.PI;
    g.add(banner);
  }
  const under = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 1.25), glow);
  under.position.y = 9.8;
  g.add(under);
  // orient to track frame
  const basis = new THREE.Matrix4().makeBasis(s0.right.clone().negate(), s0.up, s0.tangent.clone().negate());
  g.quaternion.setFromRotationMatrix(basis);
  g.position.copy(s0.pos);
  return g;
}
