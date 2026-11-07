import * as THREE from 'three';
import { clamp, fbm2, lerp, Rng, smoothstep } from '../../core/utils';
import type { GraphicsConfig } from '../../core/Settings';
import type { Track } from '../Track';
import { F_BRIDGE, F_TUNNEL } from '../TrackLayout';
import { detailTexture, rockTexture } from '../../graphics/TextureFactory';
import { disposeGroup, instanced, trs, TrackSpatialIndex, type Scenery } from './common';

export function buildRedlineCanyon(track: Track, cfg: GraphicsConfig): Scenery {
  const group = new THREE.Group();
  group.name = 'canyon-scenery';
  const rng = new Rng(77);
  const idx = new TrackSpatialIndex(track, 50);
  const b = idx.bounds;
  const margin = 1300;
  const minX = b.min.x - margin;
  const maxX = b.max.x + margin;
  const minZ = b.min.z - margin;
  const maxZ = b.max.z + margin;
  const res = Math.round(clamp(330 * Math.sqrt(cfg.scenery), 200, 420));
  const sizeX = maxX - minX;
  const sizeZ = maxZ - minZ;
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, res, res);
  geo.rotateX(-Math.PI / 2);
  geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const base = track.def.baseHeight;
  const sand = new THREE.Color('#c07a48');
  const rockA = new THREE.Color('#8e3c22');
  const rockB = new THREE.Color('#b85a2e');
  const rockC = new THREE.Color('#5e2a18');
  const mesa = new THREE.Color('#a0522d');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = idx.nearest(x, z, 420);
    const far = fbm2(x * 0.0016, z * 0.0016, 4);
    // far terrain: plains with mesas
    let y = base - 8 + far * 30 + smoothstep(0.15, 0.3, fbm2(x * 0.0009 + 3, z * 0.0009, 3)) * 120;
    let wall = 0;
    if (n) {
      const yt = n.sample.pos.y;
      // Flat valley floor wide enough that no terrain triangle can rise over the road.
      const e = n.d - (n.sample.width / 2 + 7) - Math.max(16, (sizeX / res) * 1.6);
      const deep = (n.sample.flags & F_BRIDGE) !== 0 || n.path.hoverOnly;
      const tunnel = (n.sample.flags & F_TUNNEL) !== 0;
      const wallH = (tunnel ? 70 : 45) + 70 * (0.5 + 0.5 * fbm2(x * 0.004, z * 0.004, 3));
      const rise = smoothstep(0, tunnel ? 14 : 30 + 40 * (0.5 + 0.5 * fbm2(x * 0.01, z * 0.01, 2)), e);
      const canyon = yt - 1.2 + rise * wallH + fbm2(x * 0.03, z * 0.03, 3) * 3 * rise;
      if (deep) {
        // abyss below bridges and the hover jump
        const gorgeW = n.path.hoverOnly ? 45 : 70;
        const depth = smoothstep(gorgeW, 10, n.d) * 140;
        y = Math.min(lerp(canyon, y, smoothstep(250, 420, n.d)), yt - 2 - depth + (n.d > gorgeW ? (n.d - gorgeW) * 1.2 : 0));
        if (n.path.hoverOnly) {
          // keep the main road shoulders intact near the junctions
          const m = idx.nearest(x, z, 60);
          if (m && !m.path.hoverOnly && m.d < m.sample.width / 2 + 7) y = m.sample.pos.y - 0.9;
        }
      } else {
        y = lerp(canyon, Math.max(y, canyon * 0.6 + y * 0.4), smoothstep(200, 420, n.d));
        if (e < 0) y = yt - 1.2;
      }
      wall = rise;
    }
    pos.setY(i, y);
    // colors: sand floor, striped walls
    const strata = 0.5 + 0.5 * Math.sin(y * 0.55 + fbm2(x * 0.01, z * 0.01, 2) * 3);
    if (wall < 0.08 && n) c.copy(sand).lerp(rockB, 0.15 + 0.15 * fbm2(x * 0.05, z * 0.05, 2));
    else c.copy(rockA).lerp(rockB, strata).lerp(rockC, smoothstep(0.6, 1, Math.abs(fbm2(x * 0.02, z * 0.02, 2))));
    if (!n) c.lerp(mesa, 0.4);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const rock = rockTexture();
  const tex = detailTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set(sizeX / 30, sizeZ / 30);
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0, map: tex, color: '#ffffff' });
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.receiveShadow = true;
  group.add(terrain);

  // ---- boulders
  const boulderGeo = new THREE.DodecahedronGeometry(1, 1);
  const bp = boulderGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(bp, i);
    v.multiplyScalar(0.8 + 0.4 * Math.abs(Math.sin(v.x * 3 + v.y * 5 + v.z * 7)));
    bp.setXYZ(i, v.x, v.y * 0.75, v.z);
  }
  boulderGeo.computeVertexNormals();
  const boulders: THREE.Matrix4[] = [];
  const main = track.main;
  const nB = Math.round(700 * cfg.scenery);
  for (let k = 0; k < nB; k++) {
    const s = main.samples[rng.int(0, main.count - 1)];
    if (s.flags & (F_BRIDGE | F_TUNNEL)) continue;
    const side = rng.chance(0.5) ? 1 : -1;
    const off = s.width / 2 + rng.range(6, 40);
    const p = s.pos.clone().addScaledVector(s.right, side * off);
    const sc = rng.range(0.6, 4.5);
    boulders.push(trs(p.x, p.y - 0.8 + sc * 0.2, p.z, rng.range(0, 6), sc * rng.range(0.8, 1.6), sc, sc * rng.range(0.8, 1.4), rng.range(-0.3, 0.3)));
  }
  group.add(instanced(boulderGeo, new THREE.MeshStandardMaterial({ color: '#7a3820', roughness: 0.95, map: rock }), boulders, { cast: cfg.shadows, receive: true }));

  // ---- bridge: arches + hangers over F_BRIDGE runs
  const archMat = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.3, metalness: 0.9 });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a').multiplyScalar(2.6), toneMapped: false });
  let runStart = -1;
  const bridgeRuns: [number, number][] = [];
  for (let i = 0; i < main.count; i++) {
    const on = (main.samples[i].flags & F_BRIDGE) !== 0;
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      bridgeRuns.push([runStart, i - 1]);
      runStart = -1;
    }
  }
  for (const [a, bIdx] of bridgeRuns) {
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const N = 24;
      for (let k = 0; k <= N; k++) {
        const i = Math.round(lerp(a - 12, bIdx + 12, k / N));
        const s = main.samples[Math.max(0, Math.min(main.count - 1, i))];
        const h = Math.sin((k / N) * Math.PI) * 26;
        pts.push(s.pos.clone().addScaledVector(s.right, side * (s.width / 2 + 2)).addScaledVector(s.up, h - 2));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.7, 8), archMat));
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.18, 6), glowMat).translateY(0.75));
      const hanger = new THREE.CylinderGeometry(0.06, 0.06, 1, 4);
      hanger.translate(0, 0.5, 0);
      const hm: THREE.Matrix4[] = [];
      for (let k = 1; k < N; k++) {
        const p = pts[k];
        const s = main.samples[Math.round(lerp(a - 12, bIdx + 12, k / N))];
        const roadY = s.pos.y;
        if (p.y - roadY < 1.5) continue;
        hm.push(trs(p.x, roadY + 0.8, p.z, 0, 1, p.y - roadY - 0.8, 1));
      }
      group.add(instanced(hanger, archMat, hm));
    }
    // deep support pylons
    const sMid = main.samples[Math.floor((a + bIdx) / 2)];
    const py = new THREE.CylinderGeometry(2.4, 4, 160, 10);
    py.translate(0, -80, 0);
    const pylon = new THREE.Mesh(py, new THREE.MeshStandardMaterial({ color: '#4a4f58', roughness: 0.5, metalness: 0.7 }));
    pylon.position.copy(sMid.pos).addScaledVector(sMid.up, -2.5);
    group.add(pylon);
  }

  // ---- energy pylons with blinking beacons + arch gates
  const towerGeo = new THREE.CylinderGeometry(0.6, 1.8, 1, 4);
  towerGeo.translate(0, 0.5, 0);
  const towers: THREE.Matrix4[] = [];
  const beacons: THREE.Matrix4[] = [];
  for (let i = 0; i < main.count; i += 140) {
    const s = main.samples[i];
    if (s.flags & (F_TUNNEL | F_BRIDGE)) continue;
    const side = (i / 140) % 2 ? 1 : -1;
    const p = s.pos.clone().addScaledVector(s.right, side * (s.width / 2 + 28));
    const h = rng.range(45, 80);
    towers.push(trs(p.x, p.y - 2, p.z, Math.PI / 4, 1, h, 1));
    beacons.push(trs(p.x, p.y - 2 + h + 0.6, p.z, 0, 1.2, 1.2, 1.2));
  }
  group.add(instanced(towerGeo, new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.45, metalness: 0.85 }), towers, { cast: cfg.shadows }));
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2020').multiplyScalar(4), toneMapped: false });
  group.add(instanced(new THREE.SphereGeometry(0.6, 8, 6), beaconMat, beacons));
  // gates
  const gateGeo = new THREE.TorusGeometry(1, 0.035, 6, 48, Math.PI);
  const gates: THREE.Matrix4[] = [];
  const basis = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 300; i < main.count; i += 520) {
    const s = main.samples[i];
    if (s.flags & (F_TUNNEL | F_BRIDGE)) continue;
    basis.makeBasis(s.right, s.up, s.tangent);
    q.setFromRotationMatrix(basis);
    const r = s.width / 2 + 3;
    gates.push(new THREE.Matrix4().compose(s.pos, q, new THREE.Vector3(r, r * 0.9, r)));
  }
  group.add(instanced(gateGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a40').multiplyScalar(2.8), toneMapped: false }), gates));

  let blink = 0;
  return {
    group,
    update(dt) {
      blink += dt;
      beaconMat.color.setRGB(1, 0.12, 0.12).multiplyScalar(Math.sin(blink * 3) > 0.2 ? 5 : 0.4);
    },
    dispose() {
      disposeGroup(group);
      tex.dispose();
    },
  };
}
