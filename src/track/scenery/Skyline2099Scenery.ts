import * as THREE from 'three';
import { Rng } from '../../core/utils';
import type { GraphicsConfig } from '../../core/Settings';
import type { Track } from '../Track';
import { chevronMaterial } from '../TrackMeshBuilder';
import { buildingMaterial, disposeGroup, instanced, trs, TrackSpatialIndex, type Scenery } from './common';

export function buildSkyline2099(track: Track, cfg: GraphicsConfig): Scenery {
  const group = new THREE.Group();
  group.name = 'skyline-scenery';
  const rng = new Rng(4242);
  const idx = new TrackSpatialIndex(track, 60);
  const b = idx.bounds;
  const base = track.def.baseHeight;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const animated: THREE.ShaderMaterial[] = [];
  const cloudY = base - 170;

  // ---- cloud sea (shader plane)
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.55, 0.22, -0.8).normalize() },
      uTop: { value: new THREE.Color('#fff4e6') },
      uShade: { value: new THREE.Color('#a9b6cf') },
      uFog: { value: new THREE.Color('#f6cfa2') },
    },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uTop; uniform vec3 uShade; uniform vec3 uFog; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<6;i++){ v+=a*n(p); p*=2.07; a*=0.5; } return v; }
      void main(){
        vec2 p = vW.xz * 0.0018 + vec2(uTime * 0.004, uTime * 0.002);
        float d = fbm(p);
        float d2 = fbm(p + vec2(0.03, 0.02));
        float shade = clamp((d - d2) * 6.0 + 0.6, 0.0, 1.0);
        vec3 col = mix(uShade, uTop, shade);
        float gaps = smoothstep(0.32, 0.5, d);
        col = mix(uShade * 0.55, col, gaps);
        float dist = length(vW.xz - cameraPosition.xz);
        col = mix(col, uFog, smoothstep(1200.0, 5200.0, dist));
        gl_FragColor = vec4(col, 1.0);
      }`,
    fog: false,
  });
  animated.push(cloudMat);
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000, 1, 1), cloudMat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.set(cx, cloudY, cz);
  group.add(clouds);

  // puffy cloud billboards above the sea
  const puffGeo = new THREE.PlaneGeometry(1, 1);
  const puffMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#ffffff') } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv;
      vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
      float s = length(instanceMatrix[0].xyz);
      c.xy += position.xy * s;
      gl_Position = projectionMatrix * c; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, d) * 0.55; a *= 0.6 + 0.4 * sin(vUv.x * 9.0) * sin(vUv.y * 7.0);
      gl_FragColor = vec4(mix(vec3(0.75,0.8,0.9), uColor, vUv.y) * 1.05, a); }`,
    transparent: true,
    depthWrite: false,
  });
  const puffs: THREE.Matrix4[] = [];
  for (let i = 0; i < 260 * cfg.scenery; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(200, 3800);
    const s = rng.range(120, 420);
    puffs.push(trs(cx + Math.cos(a) * r, cloudY + rng.range(5, 70), cz + Math.sin(a) * r, 0, s, s * 0.45, 1));
  }
  const puffMesh = instanced(puffGeo, puffMat, puffs);
  puffMesh.frustumCulled = false;
  group.add(puffMesh);

  // ---- arcology towers
  const glassMat = buildingMaterial({ color: '#2a3c55', roughness: 0.08, metalness: 0.95, windowIntensity: 0.35, litFraction: 0.35, cool: '#cfe8ff', accent: '#0a5c80', cell: [2.6, 4.2] });
  const whiteMat = buildingMaterial({ color: '#d9dee6', roughness: 0.3, metalness: 0.35, windowIntensity: 0.25, litFraction: 0.3, accent: '#2a8cff', cell: [4, 5] });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
  cylGeo.translate(0, 0.5, 0);
  const glassBoxes: THREE.Matrix4[] = [];
  const whiteCyl: THREE.Matrix4[] = [];
  const spires: THREE.Matrix4[] = [];
  const ringMs: THREE.Matrix4[] = [];
  const R = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5 + 1600;
  const count = Math.round(320 * cfg.scenery);
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.float()) * R;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const w = rng.range(30, 80);
    if (idx.clearance(x, z, 220) < w * 0.75 + 40) continue;
    const top = base + rng.range(-60, 320);
    const bottom = cloudY - 300;
    const h = top - bottom;
    if (rng.chance(0.55)) glassBoxes.push(trs(x, bottom, z, rng.range(0, 3), w, h, w * rng.range(0.7, 1.3)));
    else whiteCyl.push(trs(x, bottom, z, 0, w, h, w));
    if (rng.chance(0.4)) spires.push(trs(x, top, z, 0, w * 0.08, rng.range(40, 120), w * 0.08));
    if (rng.chance(0.3)) ringMs.push(trs(x, top - rng.range(20, 80), z, 0, w * 0.9, w * 0.9, w * 0.9, Math.PI / 2));
  }
  group.add(instanced(boxGeo, glassMat, glassBoxes), instanced(cylGeo, whiteMat, whiteCyl));
  const spireGeo = new THREE.ConeGeometry(1, 1, 8);
  spireGeo.translate(0, 0.5, 0);
  group.add(instanced(spireGeo, new THREE.MeshStandardMaterial({ color: '#e8ecf2', roughness: 0.2, metalness: 0.9 }), spires));
  group.add(instanced(new THREE.TorusGeometry(0.62, 0.03, 6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#29e8ff').multiplyScalar(2.2), toneMapped: false }), ringMs));

  // ---- anti-grav pylons under the highway
  const main = track.main;
  const spikeGeo = new THREE.ConeGeometry(2.2, 1, 6);
  spikeGeo.rotateX(Math.PI);
  spikeGeo.translate(0, -0.5, 0);
  const spikes: THREE.Matrix4[] = [];
  const rings: THREE.Matrix4[] = [];
  for (let i = 0; i < main.count; i += 70) {
    const s = main.samples[i];
    const len = rng.range(60, 140);
    spikes.push(trs(s.pos.x, s.pos.y - 2.3, s.pos.z, 0, 1, len, 1));
    for (let k = 0; k < 3; k++) rings.push(trs(s.pos.x, s.pos.y - 8 - k * 9, s.pos.z, 0, 4.2 - k, 4.2 - k, 4.2 - k, Math.PI / 2));
  }
  group.add(instanced(spikeGeo, new THREE.MeshStandardMaterial({ color: '#cfd5de', roughness: 0.25, metalness: 0.9 }), spikes));
  group.add(instanced(new THREE.TorusGeometry(1, 0.12, 6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#29e8ff').multiplyScalar(2.6), toneMapped: false }), rings));

  // ---- distant traffic lanes (decorative floating highways)
  const laneMat = chevronMaterial('#ffd7a8', 0.6);
  animated.push(laneMat);
  for (let k = 0; k < 7; k++) {
    const pts: THREE.Vector3[] = [];
    const ra = rng.range(R * 0.6, R * 1.1);
    const y = base + rng.range(-120, 160);
    const a0 = rng.range(0, Math.PI * 2);
    for (let j = 0; j <= 12; j++) {
      const a = a0 + (j / 12) * rng.range(1.2, 2.4);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * ra, y + Math.sin(j) * 10, cz + Math.sin(a) * ra));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 160, 6, 3, false);
    group.add(new THREE.Mesh(g, laneMat));
  }

  // ---- airships
  const shipGeo = new THREE.SphereGeometry(1, 24, 12);
  shipGeo.scale(1, 0.32, 0.32);
  const shipMat = new THREE.MeshStandardMaterial({ color: '#eef1f5', roughness: 0.35, metalness: 0.6 });
  const ships: { mesh: THREE.Mesh; a: number; r: number; v: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(shipGeo, shipMat);
    m.scale.setScalar(rng.range(60, 110));
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.012, 4, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#29e8ff').multiplyScalar(3), toneMapped: false }));
    stripe.rotation.y = Math.PI / 2;
    m.add(stripe);
    m.position.y = base + rng.range(80, 260);
    group.add(m);
    ships.push({ mesh: m, a: rng.range(0, Math.PI * 2), r: rng.range(R * 0.5, R), v: rng.range(0.004, 0.01) });
  }

  return {
    group,
    update(dt, time) {
      for (const m of animated) m.uniforms.uTime.value = time;
      for (const s of ships) {
        s.a += s.v * dt;
        s.mesh.position.x = cx + Math.cos(s.a) * s.r;
        s.mesh.position.z = cz + Math.sin(s.a) * s.r;
        s.mesh.rotation.y = -s.a;
      }
    },
    dispose() {
      disposeGroup(group);
    },
  };
}
