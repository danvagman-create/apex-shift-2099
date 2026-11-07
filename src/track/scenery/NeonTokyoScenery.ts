import * as THREE from 'three';
import { mod, Rng } from '../../core/utils';
import type { GraphicsConfig } from '../../core/Settings';
import type { Track } from '../Track';
import { F_ELEVATED, F_TUNNEL } from '../TrackLayout';
import { billboardTexture, noiseNormal } from '../../graphics/TextureFactory';
import { buildingMaterial, disposeGroup, instanced, lightPoolMaterial, neonSignMesh, trs, TrackSpatialIndex, type Scenery } from './common';

export function buildNeonTokyo(track: Track, cfg: GraphicsConfig): Scenery {
  const group = new THREE.Group();
  group.name = 'tokyo-scenery';
  const rng = new Rng(2099);
  const idx = new TrackSpatialIndex(track);
  const b = idx.bounds;
  const density = cfg.scenery;
  const animated: THREE.ShaderMaterial[] = [];

  // ---- ground (wet concrete)
  const groundMat = new THREE.MeshStandardMaterial({
    color: '#101116',
    roughness: 0.62,
    metalness: 0.1,
    envMapIntensity: 0.5,
    normalMap: noiseNormal('ground', 256, 1.2, 5, 1),
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
  (groundMat.normalMap as THREE.Texture).repeat.set(300, 300);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.min.x + b.max.x) / 2, -0.05, (b.min.z + b.max.z) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // ---- buildings on a jittered grid
  const bldMat = buildingMaterial({ color: '#1a1c22', roughness: 0.55, metalness: 0.3, windowIntensity: 1.5, litFraction: 0.42, accent: '#260a1e' });
  bldMat.envMapIntensity = 0.45;
  const towerMat = buildingMaterial({ color: '#12161d', roughness: 0.2, metalness: 0.75, windowIntensity: 1.2, litFraction: 0.32, cool: '#7fd0ff', accent: '#06303f' });
  towerMat.envMapIntensity = 0.6;
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const near: THREE.Matrix4[] = [];
  const towers: THREE.Matrix4[] = [];
  const signItems: { matrix: THREE.Matrix4; cell: number; seed: number }[] = [];
  const holo: { pos: THREE.Vector3; ry: number; w: number; h: number }[] = [];
  const step = 34 / Math.sqrt(density);
  const margin = 420;
  for (let x = b.min.x - margin; x < b.max.x + margin; x += step) {
    for (let z = b.min.z - margin; z < b.max.z + margin; z += step) {
      const px = x + rng.range(-6, 6);
      const pz = z + rng.range(-6, 6);
      const nearest = idx.nearest(px, pz, 260);
      const clear = nearest ? nearest.d - nearest.sample.width / 2 : 260;
      const w = rng.range(14, 26);
      const d = rng.range(14, 26);
      if (clear < 16 + Math.max(w, d) * 0.6) continue;
      if (rng.chance(0.12)) continue; // plazas
      let h: number;
      let ry = 0;
      if (nearest) {
        const t = nearest.sample.tangent;
        ry = Math.atan2(t.x, t.z);
      }
      const isTower = rng.chance(clear > 60 ? 0.22 : 0.08);
      if (isTower) h = rng.range(120, 280);
      else h = clear < 80 ? rng.range(22, 75) : rng.range(30, 120);
      const m = trs(px, -0.5, pz, ry, w, h, d);
      (isTower ? towers : near).push(m);
      // neon signs on faces toward the track
      if (nearest && clear < 70 && rng.chance(0.85)) {
        const toTrack = new THREE.Vector3(nearest.sample.pos.x - px, 0, nearest.sample.pos.z - pz).normalize();
        const nSigns = rng.int(1, 3);
        for (let k = 0; k < nSigns; k++) {
          const vertical = rng.chance(0.5);
          const sw = vertical ? rng.range(2.4, 4) : rng.range(8, 14);
          const sh = vertical ? sw * rng.range(2.6, 4) : sw * 0.5;
          const sy = rng.range(7, Math.min(h - 4, 46));
          const off = rng.range(-0.35, 0.35) * Math.min(w, d);
          const side = new THREE.Vector3(toTrack.z, 0, -toTrack.x);
          const faceDist = Math.max(w, d) * 0.5 + 0.6;
          const pos = new THREE.Vector3(px, sy, pz).addScaledVector(toTrack, faceDist).addScaledVector(side, off);
          const rot = Math.atan2(toTrack.x, toTrack.z);
          const mat4 = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, vertical ? Math.PI / 2 : 0)), new THREE.Vector3(vertical ? sh : sw, vertical ? sw : sh, 1));
          signItems.push({ matrix: mat4, cell: rng.int(0, 31), seed: rng.float() });
        }
        if (h > 60 && rng.chance(0.15)) holo.push({ pos: new THREE.Vector3(px, h * 0.65, pz).addScaledVector(toTrack, Math.max(w, d) * 0.5 + 1), ry: Math.atan2(toTrack.x, toTrack.z), w: Math.min(w, d) * 1.1, h: Math.min(w, d) * 0.65 });
      }
    }
  }
  // buildings bridging over the covered expressway (tunnel)
  const main = track.main;
  for (let i = 0; i < main.count; i += 22) {
    const s = main.samples[i];
    if (!(s.flags & F_TUNNEL)) continue;
    const ry = Math.atan2(s.tangent.x, s.tangent.z);
    near.push(trs(s.pos.x, s.pos.y + 9.2, s.pos.z, ry, s.width + 16, rng.range(25, 90), 34));
  }
  const bMesh = instanced(boxGeo, bldMat, near, { cast: cfg.shadows, receive: true });
  const tMesh = instanced(boxGeo, towerMat, towers, { cast: false, receive: false });
  group.add(bMesh, tMesh);

  // distant skyline ring
  const far: THREE.Matrix4[] = [];
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const R = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5 + 900;
  for (let i = 0; i < 260 * density; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = R + rng.range(0, 900);
    far.push(trs(cx + Math.cos(a) * r, -1, cz + Math.sin(a) * r, rng.range(0, 3), rng.range(40, 90), rng.range(120, 520), rng.range(40, 90)));
  }
  group.add(instanced(boxGeo, towerMat, far));

  // ---- neon signs
  if (signItems.length) {
    const signs = neonSignMesh(signItems);
    animated.push(signs.material as THREE.ShaderMaterial);
    group.add(signs);
  }

  // ---- holographic billboards
  const ads = [
    billboardTexture(['KAIYO', 'DYNAMICS // VORTEX GT-R'], '#ff2d95'),
    billboardTexture(['NEXUS', 'NEURAL LINK 9'], '#29e8ff'),
    billboardTexture(['ラーメン', '24H // AKIBA'], '#ffb000'),
    billboardTexture(['LUMEN', 'ION POWER'], '#a6ff00'),
  ];
  const holoMat = (tex: THREE.Texture) =>
    new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `uniform sampler2D uMap; uniform float uTime; varying vec2 vUv;
        void main(){ vec2 uv = vUv; uv.x += sin(uv.y * 80.0 + uTime * 3.0) * 0.002;
        vec3 c = texture2D(uMap, uv).rgb; float scan = 0.75 + 0.25 * sin(uv.y * 400.0 - uTime * 8.0);
        float glitch = step(0.985, fract(sin(floor(uTime * 6.0)) * 437.5)) * 0.5;
        gl_FragColor = vec4(c * 2.2 * scan + glitch * c, 1.0); }`,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  holo.slice(0, 18).forEach((hb, i) => {
    const mat = holoMat(ads[i % ads.length]);
    animated.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(hb.w * 2, hb.w), mat);
    mesh.position.copy(hb.pos);
    mesh.rotation.y = hb.ry;
    group.add(mesh);
  });

  // ---- street lamps + light pools along the main road
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 9, 6);
  poleGeo.translate(0, 4.5, 0);
  const armGeo = new THREE.BoxGeometry(0.15, 0.15, 3.2);
  const headGeo = new THREE.BoxGeometry(0.5, 0.12, 1.6);
  const poles: THREE.Matrix4[] = [];
  const arms: THREE.Matrix4[] = [];
  const heads: THREE.Matrix4[] = [];
  const pools: THREE.Matrix4[] = [];
  const poolsC: THREE.Matrix4[] = [];
  const spacing = Math.round(36 / main.spacing);
  for (let i = 0; i < main.count; i += spacing) {
    const s = main.samples[i];
    if (s.flags & F_TUNNEL) continue;
    for (const side of [-1, 1]) {
      if ((side < 0 ? main.wallL[i] : main.wallR[i]) === 0) continue;
      const base = s.pos.clone().addScaledVector(s.right, side * (s.width / 2 + 2.2));
      const ry = Math.atan2(s.right.x, s.right.z) + (side > 0 ? Math.PI : 0);
      poles.push(trs(base.x, base.y, base.z, ry, 1, 1, 1));
      const armPos = base.clone().addScaledVector(s.right, -side * 1.5);
      arms.push(trs(armPos.x, base.y + 9, armPos.z, ry, 1, 1, 1));
      const headPos = base.clone().addScaledVector(s.right, -side * 3);
      heads.push(trs(headPos.x, base.y + 8.85, headPos.z, ry + Math.PI / 2, 1, 1, 1));
      const poolPos = s.pos.clone().addScaledVector(s.right, side * (s.width / 2 - 3.5)).addScaledVector(s.up, 0.05);
      const pm = trs(poolPos.x, poolPos.y, poolPos.z, 0, 16, 1, 16, -Math.PI / 2);
      ((i / spacing) % 2 === 0 ? pools : poolsC).push(pm);
    }
  }
  const metal = new THREE.MeshStandardMaterial({ color: '#2a2d34', roughness: 0.4, metalness: 0.8 });
  group.add(instanced(poleGeo, metal, poles, { cast: cfg.shadows }));
  group.add(instanced(armGeo, metal, arms));
  group.add(instanced(headGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1d6').multiplyScalar(3), toneMapped: false }), heads));
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  group.add(instanced(poolGeo, lightPoolMaterial('#ffb36b', 0.32), pools));
  group.add(instanced(poolGeo, lightPoolMaterial('#5fd8ff', 0.28), poolsC));

  // ---- elevated section pillars
  const pillarGeo = new THREE.CylinderGeometry(1.1, 1.3, 1, 10);
  pillarGeo.translate(0, 0.5, 0);
  const pillars: THREE.Matrix4[] = [];
  for (let i = 0; i < main.count; i += 12) {
    const s = main.samples[i];
    if (!(s.flags & F_ELEVATED) || s.pos.y < 2.5) continue;
    const h = s.pos.y - 1.2;
    pillars.push(trs(s.pos.x, 0, s.pos.z, 0, 1, h, 1));
  }
  if (pillars.length) group.add(instanced(pillarGeo, new THREE.MeshStandardMaterial({ color: '#3b3f48', roughness: 0.7 }), pillars, { cast: cfg.shadows }));

  // ---- canal under the hover rail
  for (const br of track.branches) {
    const mid = br.samples[Math.floor(br.count / 2)];
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(br.length * 0.95, 140),
      new THREE.MeshStandardMaterial({ color: '#03070d', roughness: 0.06, metalness: 0.9, envMapIntensity: 2.2, normalMap: noiseNormal('water', 256, 2.5, 21, 2), normalScale: new THREE.Vector2(0.15, 0.15) }),
    );
    (water.material as THREE.MeshStandardMaterial).normalMap!.repeat.set(20, 6);
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = Math.atan2(mid.tangent.x, mid.tangent.z) - Math.PI / 2;
    water.position.set(mid.pos.x, 0.02, mid.pos.z);
    water.userData.water = true;
    group.add(water);
    // canal walls glow
    const edge = new THREE.Mesh(new THREE.BoxGeometry(br.length * 0.95, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color('#29e8ff').multiplyScalar(2), toneMapped: false }));
    edge.rotation.y = water.rotation.z;
    for (const s of [-1, 1]) {
      const e = edge.clone();
      e.position.set(mid.pos.x + Math.cos(water.rotation.z) * 0 + -Math.sin(-water.rotation.z) * 0, 0.1, mid.pos.z);
      e.position.addScaledVector(new THREE.Vector3(mid.right.x, 0, mid.right.z).normalize(), s * 70);
      group.add(e);
    }
  }

  // ---- flying traffic
  const carGeo = new THREE.BoxGeometry(2.2, 0.8, 4.5);
  const flyCount = Math.round(70 * density);
  const fly = new THREE.InstancedMesh(carGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff'), toneMapped: false }), flyCount);
  const flyData: { r: number; h: number; a: number; v: number; cx: number; cz: number }[] = [];
  const col = new THREE.Color();
  for (let i = 0; i < flyCount; i++) {
    flyData.push({ r: rng.range(300, R), h: rng.range(45, 150), a: rng.range(0, Math.PI * 2), v: rng.range(0.02, 0.06) * (rng.chance(0.5) ? 1 : -1), cx, cz });
    col.set(rng.pick(['#ff2d95', '#29e8ff', '#fff1d6', '#ffb000'])).multiplyScalar(3);
    fly.setColorAt(i, col);
  }
  fly.frustumCulled = false;
  group.add(fly);
  const m4 = new THREE.Matrix4();

  return {
    group,
    update(dt, time) {
      for (const m of animated) if (m.uniforms.uTime) m.uniforms.uTime.value = time;
      for (let i = 0; i < flyCount; i++) {
        const f = flyData[i];
        f.a += f.v * dt;
        const x = f.cx + Math.cos(f.a) * f.r;
        const z = f.cz + Math.sin(f.a) * f.r;
        m4.compose(new THREE.Vector3(x, f.h + Math.sin(time * 0.5 + i) * 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -f.a + (f.v > 0 ? 0 : Math.PI), 0)), new THREE.Vector3(1, 1, 1));
        fly.setMatrixAt(i, m4);
      }
      fly.instanceMatrix.needsUpdate = true;
      const wn = (groundMat.normalMap as THREE.Texture).offset;
      wn.y = mod(time * 0.01, 1);
    },
    dispose() {
      disposeGroup(group);
    },
  };
}
