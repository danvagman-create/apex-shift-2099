import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/utils';
import {
  buildBodyGeometry,
  interpStation,
  mergeGeos,
  profilePoint,
  rimGeometry,
  surfacePoint,
  surfaceRibbon,
  tireGeometry,
  wingGeometry,
  zAt,
} from './CarModelBuilder';
import { applyFinish, flameMaterial, glowDiscMaterial, ledMaterial, makePaint, sharedCarMaterials } from './CarMaterials';
import type { PaintFinish, VehicleSpec, VehicleStyle } from './VehicleSpecs';

export interface CarLook {
  paint: string;
  finish: PaintFinish;
  accent: string;
  light: string;
  rim: string;
  hover: string;
}

export interface CarAnimState {
  transform: number;
  speed: number;
  steerAngle: number;
  bodyPitch: number;
  bodyRoll: number;
  bounce: number;
  nitro: boolean;
  throttle: number;
  brake: number;
  ride: number; // height of car origin above the surface
  drifting?: boolean;
}

interface WheelRig {
  pivot: THREE.Group;
  steer: THREE.Group;
  spin: THREE.Group;
  side: 1 | -1;
  front: boolean;
  z: number;
  thrusterGlow: THREE.Mesh;
  thrusterCone: THREE.Mesh;
}

export interface CarModelOptions {
  lod: 'high' | 'low' | 'auto';
  interior: boolean;
  shadows: boolean;
}

export class CarModel extends THREE.Group {
  readonly bodyPivot = new THREE.Group();
  readonly style: VehicleStyle;
  readonly paintMat: THREE.MeshPhysicalMaterial;
  readonly accentMat: THREE.MeshPhysicalMaterial;
  readonly rimMat: THREE.MeshStandardMaterial;
  readonly headMat: THREE.MeshBasicMaterial;
  readonly tailMat: THREE.MeshBasicMaterial;
  readonly hoverLedMat: THREE.MeshBasicMaterial;
  readonly nozzleGlowMat: THREE.MeshBasicMaterial;
  private readonly wheels: WheelRig[] = [];
  private readonly flames: THREE.Mesh[] = [];
  private readonly flameMat: THREE.ShaderMaterial;
  private readonly thrustMat: THREE.ShaderMaterial;
  private readonly thrusterGlowMat: THREE.ShaderMaterial;
  private readonly underglowMat: THREE.ShaderMaterial;
  private readonly underglow: THREE.Mesh;
  private readonly fins: THREE.Group[] = [];
  private wingPivot: THREE.Group | null = null;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly ownMaterials: THREE.Material[] = [];
  private spinAngle = 0;
  private flamePower = 0;
  private time = 0;
  private look: CarLook;
  /** Local positions of headlights (for light sources / flares). */
  readonly headlightAnchor = new THREE.Vector3();
  readonly cockpitAnchor = new THREE.Vector3();
  readonly hoodAnchor = new THREE.Vector3();
  readonly nozzleAnchors: THREE.Vector3[] = [];

  constructor(
    public readonly spec: VehicleSpec,
    look: CarLook,
    private readonly opts: CarModelOptions = { lod: 'high', interior: true, shadows: true },
  ) {
    super();
    this.look = { ...look };
    this.style = spec.style;
    const st = this.style;
    const sh = sharedCarMaterials();
    this.add(this.bodyPivot);
    this.name = spec.name;

    this.paintMat = makePaint(look.paint, look.finish);
    this.accentMat = new THREE.MeshPhysicalMaterial({ color: look.accent, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.rimMat = new THREE.MeshStandardMaterial({ color: look.rim, metalness: 0.92, roughness: 0.22 });
    this.headMat = ledMaterial(look.light, 5);
    this.tailMat = ledMaterial('#ff1030', 3);
    this.hoverLedMat = ledMaterial(look.hover, 0.0);
    this.nozzleGlowMat = ledMaterial(look.hover, 2);
    this.flameMat = flameMaterial('#e9f6ff', look.hover);
    this.thrustMat = flameMaterial('#ffffff', look.hover);
    this.thrusterGlowMat = glowDiscMaterial(look.hover);
    this.underglowMat = glowDiscMaterial(look.hover);
    this.ownMaterials.push(this.paintMat, this.accentMat, this.rimMat, this.headMat, this.tailMat, this.hoverLedMat, this.nozzleGlowMat, this.flameMat, this.thrustMat, this.thrusterGlowMat, this.underglowMat);

    const glassMat = opts.interior ? sh.glass : sh.glassOpaque;
    const bodyMats = [this.paintMat, glassMat, sh.under, sh.tailPanel];

    // ---- body (LOD) ----
    if (opts.lod === 'auto') {
      const lod = new THREE.LOD();
      const hi = this.track(buildBodyGeometry(st, 'high'));
      const lo = this.track(buildBodyGeometry(st, 'low'));
      lod.addLevel(this.mesh(hi, bodyMats), 0);
      lod.addLevel(this.mesh(lo, bodyMats), 45);
      this.bodyPivot.add(lod);
    } else {
      this.bodyPivot.add(this.mesh(this.track(buildBodyGeometry(st, opts.lod)), bodyMats));
    }

    this.buildLights();
    this.buildTrim();
    this.buildWing();
    this.buildNozzles();
    this.buildFins();
    if (opts.interior) this.buildInterior();
    this.buildWheels();

    // underglow (ground plane)
    const ug = new THREE.PlaneGeometry(spec.physics.width * 1.5, st.length * 1.25);
    ug.rotateX(-Math.PI / 2);
    this.underglow = new THREE.Mesh(this.track(ug), this.underglowMat);
    this.underglow.renderOrder = 2;
    this.add(this.underglow);

    // anchors
    const t0 = interpStation(st.stations, st.glass[0] + 0.12);
    this.cockpitAnchor.set(0, t0.sh + 0.12, zAt(st, st.glass[0] + 0.14));
    this.hoodAnchor.set(0, interpStation(st.stations, 0.12).sh + 0.25, zAt(st, 0.12));
    surfacePoint(st, 0.05, 0.45, 1, this.headlightAnchor);
    this.headlightAnchor.x = 0;

    this.mergeStatic();
    if (opts.shadows) {
      this.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material & { isMeshStandardMaterial?: boolean };
        if (m.isMeshStandardMaterial && !m.transparent) mesh.castShadow = true;
      });
    }
  }

  /** Merge non-animated single-material body parts by material to cut draw calls. */
  private mergeStatic(): void {
    const excluded = new Set<THREE.Object3D>([...this.flames, ...this.fins]);
    if (this.wingPivot) excluded.add(this.wingPivot);
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of [...this.bodyPivot.children]) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || excluded.has(mesh) || Array.isArray(mesh.material)) continue;
      const arr = groups.get(mesh.material) ?? [];
      arr.push(mesh);
      groups.set(mesh.material, arr);
    }
    for (const [mat, meshes] of groups) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        const g = m.geometry.clone();
        g.applyMatrix4(m.matrix);
        return g;
      });
      const merged = this.track(mergeGeos(geos));
      for (const m of meshes) this.bodyPivot.remove(m);
      const out = new THREE.Mesh(merged, mat);
      out.renderOrder = meshes[0].renderOrder;
      this.bodyPivot.add(out);
    }
  }

  private track<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]): THREE.Mesh {
    return new THREE.Mesh(g, m);
  }

  // ---------------------------------------------------------------- lights
  private buildLights(): void {
    const st = this.style;
    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.bodyPivot) => {
      const mesh = new THREE.Mesh(this.track(g), m);
      parent.add(mesh);
      return mesh;
    };
    for (const side of [1, -1] as const) {
      switch (st.head) {
        case 'blade':
          add(surfaceRibbon(st, [[0.028, 0.4], [0.07, 0.47], [0.13, 0.53]], side, 0.03), this.headMat);
          add(surfaceRibbon(st, [[0.04, 0.33], [0.09, 0.37]], side, 0.018), this.headMat);
          break;
        case 'twin':
          add(surfaceRibbon(st, [[0.03, 0.42], [0.075, 0.46]], side, 0.034), this.headMat);
          add(surfaceRibbon(st, [[0.045, 0.36], [0.09, 0.4]], side, 0.034), this.headMat);
          break;
        case 'arrow':
          add(surfaceRibbon(st, [[0.022, 0.37], [0.075, 0.45], [0.045, 0.53]], side, 0.026), this.headMat);
          break;
        case 'bar':
          add(surfaceRibbon(st, [[0.03, 0.38], [0.026, 0.5], [0.022, 0.6], [0.02, 0.68]], side, 0.03), this.headMat);
          break;
        case 'ring':
          add(surfaceRibbon(st, [[0.04, 0.38], [0.06, 0.44], [0.08, 0.38], [0.06, 0.32], [0.04, 0.38]], side, 0.02), this.headMat);
          break;
      }
      // hover-mode accent LED along the lower side
      add(surfaceRibbon(st, [[0.12, 0.26], [0.45, 0.255], [0.86, 0.26]], side, 0.02, 0.008, 30), this.hoverLedMat);
    }
    // taillights on flat tail panel
    const tail = interpStation(st.stations, 1);
    const zT = zAt(st, 1) - 0.006;
    const p = new THREE.Vector2();
    const outline = (u0: number, u1: number, side: 1 | -1, inset: number, n = 10): THREE.Vector2[] => {
      const pts: THREE.Vector2[] = [];
      const cy = (tail.mid + tail.bot) / 2;
      for (let i = 0; i <= n; i++) {
        profilePoint(tail, st, lerp(u0, u1, i / n), p);
        pts.push(new THREE.Vector2(p.x * side * (1 - inset), cy + (p.y - cy) * (1 - inset)));
      }
      return pts;
    };
    const strip = (pts: THREE.Vector2[], w: number) => this.track(stripXY(pts, w, zT));
    switch (st.tail) {
      case 'bar': {
        const left = outline(0.36, 0.62, 1, 0.1);
        const right = outline(0.62, 0.36, -1, 0.1);
        add(strip([...right, ...left.reverse()], 0.045), this.tailMat);
        break;
      }
      case 'twin':
        for (const s of [1, -1] as const) {
          add(strip(outline(0.34, 0.5, s, 0.08), 0.05), this.tailMat);
          add(strip(outline(0.34, 0.48, s, 0.22), 0.03), this.tailMat);
        }
        break;
      case 'vee':
        for (const s of [1, -1] as const) {
          const a = outline(0.3, 0.44, s, 0.06, 4);
          const b = outline(0.44, 0.56, s, 0.3, 4);
          add(strip([...a, ...b], 0.035), this.tailMat);
        }
        break;
      case 'ring':
        for (const s of [1, -1] as const) {
          for (const xo of [0.62, 0.32]) {
            const ring = new THREE.TorusGeometry(0.075, 0.016, 6, 24);
            ring.translate(xo * s * tail.w, tail.mid + 0.08, zT);
            add(ring, this.tailMat);
          }
        }
        break;
    }
    // third brake light / rear light bar on deck edge
    add(strip(outline(0.6, 0.66, 1, 0.02, 3).concat(outline(0.66, 0.6, -1, 0.02, 3)), 0.015), this.tailMat);
  }

  // ---------------------------------------------------------------- trim
  private buildTrim(): void {
    const st = this.style;
    const sh = sharedCarMaterials();
    for (const side of [1, -1] as const) {
      // character line in accent color
      const m1 = new THREE.Mesh(this.track(surfaceRibbon(st, [[0.08, 0.34], [0.3, 0.33], [0.6, 0.35], [0.92, 0.37]], side, 0.03, 0.005, 40)), this.accentMat);
      this.bodyPivot.add(m1);
      // side intake slash
      const intake = new THREE.Mesh(this.track(surfaceRibbon(st, [[st.glass[1] - 0.04, 0.31], [st.glass[1] + 0.03, 0.36], [st.glass[1] + 0.1, 0.43]], side, 0.06, 0.004, 10)), sh.tailPanel);
      this.bodyPivot.add(intake);
      // mirror
      const mt = st.glass[0] + 0.06;
      const mp = surfacePoint(st, mt, 0.7, side);
      const mirror = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.07, 12, 8)), this.paintMat);
      mirror.scale.set(1.4, 0.75, 1.6);
      mirror.position.set(mp.x + side * 0.16, mp.y + 0.03, mp.z);
      this.bodyPivot.add(mirror);
      const stalk = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.16, 0.02, 0.05)), sh.carbon);
      stalk.position.set(mp.x + side * 0.07, mp.y + 0.02, mp.z);
      this.bodyPivot.add(stalk);
      const mirrorLed = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.02, 0.012, 0.12)), this.headMat);
      mirrorLed.position.set(mp.x + side * 0.26, mp.y + 0.03, mp.z);
      this.bodyPivot.add(mirrorLed);
    }
    // front splitter
    const front = new THREE.Shape();
    const pts: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * 0.16;
      const s = interpStation(st.stations, t);
      pts.push([s.w * 0.98 + st.splitter * 0.3, zAt(st, t) + st.splitter * (1 - i / 8)]);
    }
    front.moveTo(-pts[pts.length - 1][0], pts[pts.length - 1][1]);
    for (let i = pts.length - 1; i >= 0; i--) front.lineTo(-pts[i][0], pts[i][1]);
    for (let i = 0; i < pts.length; i++) front.lineTo(pts[i][0], pts[i][1]);
    const sg = new THREE.ExtrudeGeometry(front, { depth: 0.022, bevelEnabled: false });
    sg.rotateX(Math.PI / 2);
    const s0 = interpStation(st.stations, 0.05);
    sg.translate(0, s0.bot + 0.012, 0);
    this.bodyPivot.add(new THREE.Mesh(this.track(sg), sh.carbon));
    // diffuser fins
    const tail = interpStation(st.stations, 0.96);
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.02, 0.16, 0.55)), sh.carbon);
      fin.position.set(i * 0.26, tail.bot + 0.06, zAt(st, 1) + 0.3);
      fin.rotation.x = 0.22;
      this.bodyPivot.add(fin);
    }
    // shark fin
    if (st.sharkFin) {
      const f = new THREE.Shape();
      const tA = 0.6;
      const tB = 0.92;
      const zA = zAt(st, tA);
      const zB = zAt(st, tB);
      const yA = interpStation(st.stations, tA).top;
      const yB = interpStation(st.stations, tB).top;
      f.moveTo(zA, yA - 0.02);
      f.lineTo(zB, yB - 0.02);
      f.lineTo(zB + 0.05, yB + 0.24);
      f.lineTo(zA - 0.25, yA + 0.02);
      const fg = new THREE.ExtrudeGeometry(f, { depth: 0.018, bevelEnabled: false });
      fg.rotateY(-Math.PI / 2);
      fg.translate(0.009, 0, 0);
      this.bodyPivot.add(new THREE.Mesh(this.track(fg), this.paintMat));
    }
  }

  // ---------------------------------------------------------------- wing
  private buildWing(): void {
    const st = this.style;
    const sh = sharedCarMaterials();
    const tail = interpStation(st.stations, 0.94);
    const zW = zAt(st, 0.94);
    const span = Math.min(1.9, tail.w * 1.75);
    if (st.wing === 'none') return;
    const pivot = new THREE.Group();
    this.wingPivot = pivot;
    if (st.wing === 'ducktail' || st.wing === 'blade') {
      const g = wingGeometry(span * (st.wing === 'blade' ? 0.92 : 0.85), st.wing === 'blade' ? 0.22 : 0.3, 0.1);
      const wing = new THREE.Mesh(this.track(g), st.wing === 'blade' ? this.accentMat : this.paintMat);
      pivot.position.set(0, st.wingHeight, zW + 0.05);
      pivot.add(wing);
      const led = new THREE.Mesh(this.track(new THREE.BoxGeometry(span * 0.8, 0.012, 0.012)), this.tailMat);
      led.position.set(0, -0.005, -0.11);
      pivot.add(led);
      this.bodyPivot.add(pivot);
      return;
    }
    const chord = st.wing === 'high' ? 0.36 : 0.3;
    const main = new THREE.Mesh(this.track(wingGeometry(span, chord, 0.13)), sh.carbon);
    pivot.add(main);
    if (st.wing === 'twin') {
      const flap = new THREE.Mesh(this.track(wingGeometry(span * 0.96, chord * 0.6, 0.12)), this.accentMat);
      flap.position.set(0, 0.09, -chord * 0.55);
      flap.rotation.x = -0.35;
      pivot.add(flap);
    }
    // endplates
    for (const s of [1, -1]) {
      const plate = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.016, 0.17, chord * 1.15)), this.paintMat);
      plate.position.set((s * span) / 2, 0.04, -0.02);
      pivot.add(plate);
      const led = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.02, 0.13, 0.012)), this.tailMat);
      led.position.set((s * span) / 2, 0.03, -chord * 0.58);
      pivot.add(led);
    }
    pivot.position.set(0, st.wingHeight, zW);
    this.bodyPivot.add(pivot);
    // struts
    const deckY = tail.sh;
    const strutH = st.wingHeight - deckY;
    for (const s of [1, -1]) {
      let g: THREE.BufferGeometry;
      if (st.wing === 'swan') {
        const curve = new THREE.CubicBezierCurve3(
          new THREE.Vector3(0, deckY - 0.02, zW + 0.2),
          new THREE.Vector3(0, deckY + strutH * 0.9, zW + 0.25),
          new THREE.Vector3(0, st.wingHeight + 0.2, zW - 0.05),
          new THREE.Vector3(0, st.wingHeight + 0.03, zW - 0.1),
        );
        g = new THREE.TubeGeometry(curve, 12, 0.022, 6, false);
      } else {
        g = new THREE.BoxGeometry(0.03, strutH, 0.12);
        g.translate(0, deckY + strutH / 2, zW + 0.02);
      }
      const strut = new THREE.Mesh(this.track(g), sh.darkChrome);
      strut.position.x = s * span * 0.28;
      this.bodyPivot.add(strut);
    }
  }

  // ---------------------------------------------------------------- nozzles & flames
  private buildNozzles(): void {
    const st = this.style;
    const sh = sharedCarMaterials();
    const tail = interpStation(st.stations, 1);
    const zT = zAt(st, 1);
    const xs = st.nozzles === 2 ? [-0.24, 0.24] : [-0.4, -0.16, 0.16, 0.4];
    const r = st.nozzleRadius;
    const y = Math.max(tail.bot + r + 0.04, tail.mid - 0.12);
    for (const x of xs) {
      const shell = new THREE.Mesh(this.track(new THREE.CylinderGeometry(r * 1.15, r * 1.25, 0.16, 18, 1, true)), sh.darkChrome);
      shell.rotation.x = Math.PI / 2;
      shell.position.set(x, y, zT - 0.02);
      shell.material = sh.darkChrome;
      (shell.material as THREE.Material).side = THREE.DoubleSide;
      this.bodyPivot.add(shell);
      const glow = new THREE.Mesh(this.track(new THREE.CircleGeometry(r, 18)), this.nozzleGlowMat);
      glow.position.set(x, y, zT + 0.03);
      glow.rotation.y = Math.PI;
      this.bodyPivot.add(glow);
      const len = 1.6;
      const cone = new THREE.ConeGeometry(r * 0.95, len, 16, 1, true);
      cone.rotateX(-Math.PI / 2);
      cone.translate(0, 0, -len / 2);
      const flame = new THREE.Mesh(this.track(cone), this.flameMat);
      flame.position.set(x, y, zT - 0.08);
      flame.renderOrder = 3;
      flame.frustumCulled = false;
      this.bodyPivot.add(flame);
      this.flames.push(flame);
      this.nozzleAnchors.push(new THREE.Vector3(x, y, zT - 0.1));
    }
  }

  // ---------------------------------------------------------------- hover fins
  private buildFins(): void {
    const st = this.style;
    const s = interpStation(st.stations, 0.5);
    for (const side of [1, -1] as const) {
      const g = new THREE.Group();
      const shape = new THREE.Shape();
      const L = st.sideFins;
      shape.moveTo(0, 0);
      shape.lineTo(L, 0.18);
      shape.lineTo(L, 0.32);
      shape.lineTo(0, 0.9);
      shape.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, 0, -0.45);
      const fin = new THREE.Mesh(this.track(geo), sharedCarMaterials().carbon);
      if (side < 0) fin.scale.x = -1;
      g.add(fin);
      const edge = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.02, 0.03, 0.16)), this.hoverLedMat);
      edge.position.set(side * L, 0, 0.2);
      g.add(edge);
      g.position.set(side * (s.w - L - 0.02), s.mid - 0.08, zAt(st, 0.5));
      g.userData.side = side;
      g.userData.base = s.w - L - 0.02;
      g.userData.ext = s.w + 0.02;
      this.bodyPivot.add(g);
      this.fins.push(g);
    }
  }

  // ---------------------------------------------------------------- interior
  private buildInterior(): void {
    const st = this.style;
    const sh = sharedCarMaterials();
    const tc = (st.glass[0] + st.glass[1]) / 2;
    const s = interpStation(st.stations, tc);
    const floorY = s.bot + 0.12;
    const zc = zAt(st, tc);
    for (const side of [1, -1]) {
      const seat = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.42, 0.1, 0.5)), sh.interior);
      seat.position.set(side * 0.3, floorY + 0.12, zc - 0.05);
      this.bodyPivot.add(seat);
      const back = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.42, 0.55, 0.1)), sh.interior);
      back.position.set(side * 0.3, floorY + 0.4, zc - 0.32);
      back.rotation.x = -0.35;
      this.bodyPivot.add(back);
      const stripe = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.06, 0.5, 0.105)), this.accentMat);
      stripe.position.copy(back.position);
      stripe.rotation.copy(back.rotation);
      this.bodyPivot.add(stripe);
    }
    const zd = zAt(st, st.glass[0] + 0.06);
    const sd = interpStation(st.stations, st.glass[0] + 0.06);
    const dash = new THREE.Mesh(this.track(new THREE.BoxGeometry(s.cw * 1.7, 0.12, 0.3)), sh.interior);
    dash.position.set(0, sd.sh - 0.08, zd - 0.08);
    this.bodyPivot.add(dash);
    const screen = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.5, 0.11)), sh.screen);
    screen.position.set(0.28, sd.sh - 0.01, zd - 0.24);
    screen.rotation.x = -0.6;
    screen.rotation.y = Math.PI;
    this.bodyPivot.add(screen);
    const yoke = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.15, 0.018, 6, 20, Math.PI)), sh.darkChrome);
    yoke.position.set(0.3, sd.sh - 0.02, zd - 0.32);
    yoke.rotation.set(-0.3, Math.PI, Math.PI);
    this.bodyPivot.add(yoke);
  }

  // ---------------------------------------------------------------- wheels
  private buildWheels(): void {
    const st = this.style;
    const sh = sharedCarMaterials();
    const lod = this.opts.lod === 'high' ? 'high' : 'low';
    const tire = this.track(tireGeometry(st.wheelRadius, st.tireWidth, lod));
    const rim = this.track(rimGeometry(st.wheelRadius, st.tireWidth, st.rim, lod));
    const disc = new THREE.CylinderGeometry(st.wheelRadius * 0.56, st.wheelRadius * 0.56, 0.03, 24);
    disc.rotateZ(Math.PI / 2);
    this.track(disc);
    const caliper = new THREE.BoxGeometry(0.07, 0.16, 0.2);
    this.track(caliper);
    const glowDisc = this.track(new THREE.CircleGeometry(st.wheelRadius * 0.95, 24));
    const coneLen = 1.0;
    const cone = new THREE.ConeGeometry(st.wheelRadius * 0.85, coneLen, 20, 1, true);
    // tip should point outward along +X
    cone.rotateZ(-Math.PI / 2);
    cone.translate(coneLen / 2, 0, 0);
    this.track(cone);
    const rimRing = this.track(new THREE.TorusGeometry(st.wheelRadius * 0.69, 0.008, 4, 36));
    for (const front of [true, false]) {
      for (const side of [1, -1] as const) {
        const z = zAt(st, front ? st.frontAxleT : st.rearAxleT);
        const pivot = new THREE.Group();
        pivot.position.set(side * st.trackHalf, st.wheelRadius, z);
        const steer = new THREE.Group();
        const spin = new THREE.Group();
        pivot.add(steer);
        steer.add(spin);
        const wheelVis = new THREE.Group();
        if (side < 0) wheelVis.rotation.y = Math.PI;
        spin.add(wheelVis);
        wheelVis.add(new THREE.Mesh(tire, sh.rubber));
        wheelVis.add(new THREE.Mesh(rim, this.rimMat));
        const ring = new THREE.Mesh(rimRing, this.nozzleGlowMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = st.tireWidth * 0.4;
        wheelVis.add(ring);
        const brake = new THREE.Group();
        if (side < 0) brake.rotation.y = Math.PI;
        const d = new THREE.Mesh(disc, sh.brakeDisc);
        d.position.x = st.tireWidth * 0.05;
        brake.add(d);
        const cal = new THREE.Mesh(caliper, this.accentMat);
        cal.position.set(st.tireWidth * 0.18, st.wheelRadius * 0.38, -0.08);
        brake.add(cal);
        steer.add(brake);
        // hover thruster on the outer face
        const g = new THREE.Mesh(glowDisc, this.thrusterGlowMat);
        g.position.x = side * (st.tireWidth / 2 + 0.03);
        g.rotation.y = (side * Math.PI) / 2;
        g.renderOrder = 3;
        pivot.add(g);
        const c = new THREE.Mesh(cone, this.thrustMat);
        c.position.x = side * (st.tireWidth / 2 + 0.02);
        if (side < 0) c.rotation.y = Math.PI;
        c.renderOrder = 3;
        c.frustumCulled = false;
        pivot.add(c);
        this.add(pivot);
        this.wheels.push({ pivot, steer, spin, side, front, z, thrusterGlow: g, thrusterCone: c });
      }
    }
  }

  // ---------------------------------------------------------------- customization
  setLook(look: Partial<CarLook>): void {
    Object.assign(this.look, look);
    if (look.paint) this.paintMat.color.set(look.paint);
    if (look.finish) applyFinish(this.paintMat, look.finish);
    if (look.accent) this.accentMat.color.set(look.accent);
    if (look.rim) this.rimMat.color.set(look.rim);
    if (look.light) this.headMat.color.set(look.light).multiplyScalar(5);
    if (look.hover) {
      this.nozzleGlowMat.color.set(look.hover).multiplyScalar(2);
      (this.thrusterGlowMat.uniforms.uColor.value as THREE.Color).set(look.hover);
      (this.underglowMat.uniforms.uColor.value as THREE.Color).set(look.hover);
      (this.flameMat.uniforms.uOuter.value as THREE.Color).set(look.hover);
      (this.thrustMat.uniforms.uOuter.value as THREE.Color).set(look.hover);
    }
  }

  getLook(): CarLook {
    return { ...this.look };
  }

  /** Make the car a translucent hologram (time trial ghost). */
  setGhost(color = '#4de1ff'): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ownMaterials.push(mat);
    this.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = mat;
        m.castShadow = false;
      }
    });
  }

  // ---------------------------------------------------------------- animation
  update(dt: number, s: CarAnimState): void {
    this.time += dt;
    const st = this.style;
    const p = clamp(s.transform, 0, 1);
    this.bodyPivot.rotation.set(s.bodyPitch, 0, s.bodyRoll);
    this.bodyPivot.position.y = s.bounce;

    const a = smoothstep(0, 0.35, p);
    const b = smoothstep(0.2, 0.75, p);
    const c = smoothstep(0.55, 1, p);
    const thrust = smoothstep(0.6, 1, p);
    this.spinAngle += ((s.speed * dt) / st.wheelRadius) * (1 - b);
    const flick = 0.85 + 0.15 * Math.sin(this.time * 47);
    for (const w of this.wheels) {
      // suspension illusion from body pitch/roll (front/back, left/right)
      const susp = (w.front ? -s.bodyPitch : s.bodyPitch) * 0.9 + w.side * s.bodyRoll * 0.5;
      const yRoad = st.wheelRadius + clamp(susp, -0.05, 0.05) * (1 - a);
      w.pivot.position.set(
        w.side * lerp(st.trackHalf, st.trackHalf - 0.06, c),
        lerp(yRoad - 0.1 * a, -0.05, c),
        w.z,
      );
      w.pivot.rotation.z = -w.side * (Math.PI / 2) * b;
      w.steer.rotation.y = w.front ? s.steerAngle * (1 - b) : 0;
      w.spin.rotation.x = this.spinAngle;
      const gi = thrust * flick * (0.8 + 0.5 * s.throttle);
      (w.thrusterGlow.material as THREE.ShaderMaterial).uniforms.uIntensity.value = gi * 1.6;
      w.thrusterGlow.visible = gi > 0.01;
      w.thrusterCone.visible = gi > 0.01;
      w.thrusterCone.scale.set(0.5 + 0.6 * s.throttle + (s.nitro ? 0.4 : 0), 1, 1);
    }
    this.thrustMat.uniforms.uTime.value = this.time;
    this.thrustMat.uniforms.uPower.value = thrust * (0.35 + 0.35 * s.throttle);

    // fins slide out in hover mode
    for (const f of this.fins) {
      const side = f.userData.side as number;
      f.position.x = side * lerp(f.userData.base as number, f.userData.ext as number, c);
    }
    // active aero
    if (this.wingPivot) {
      const airbrake = s.brake > 0.5 && s.speed > 30 ? 0.45 : 0;
      this.wingPivot.rotation.x = damp(this.wingPivot.rotation.x, airbrake - c * 0.12, 8, dt);
      this.wingPivot.position.y = st.wingHeight + c * 0.06;
    }
    // nitro flames
    const target = s.nitro ? 1 : p > 0.5 ? 0.25 + 0.25 * s.throttle : s.throttle > 0.9 && s.speed < 25 ? 0.12 : 0;
    this.flamePower = damp(this.flamePower, target, s.nitro ? 18 : 8, dt);
    this.flameMat.uniforms.uTime.value = this.time;
    this.flameMat.uniforms.uPower.value = this.flamePower;
    for (const f of this.flames) {
      f.visible = this.flamePower > 0.01;
      f.scale.set(1, 1, 0.35 + this.flamePower * (s.nitro ? 1.5 : 0.6) * (0.9 + 0.1 * Math.sin(this.time * 70)));
    }
    this.nozzleGlowMat.color.set(this.look.hover).multiplyScalar(1.2 + this.flamePower * 3);
    // lights
    this.tailMat.color.setRGB(1, 0.06, 0.15).multiplyScalar(s.brake > 0.1 ? 9 : 3);
    this.hoverLedMat.color.set(this.look.hover).multiplyScalar(0.25 + 4.5 * thrust);
    // underglow stays on the ground
    this.underglow.position.y = -s.ride + 0.04;
    this.underglowMat.uniforms.uIntensity.value = 0.18 + 0.9 * thrust;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.ownMaterials) m.dispose();
    this.removeFromParent();
  }
}

/** Thick polyline strip in the XY plane at depth z (faces -Z). */
function stripXY(pts: THREE.Vector2[], width: number, z: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const nx = -ty * (width / 2);
    const ny = tx * (width / 2);
    pos.push(pts[i].x + nx, pts[i].y + ny, z, pts[i].x - nx, pts[i].y - ny, z);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export { mergeGeos };
