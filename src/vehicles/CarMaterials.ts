import * as THREE from 'three';
import { carbonFiber, noiseNormal, tireTexture } from '../graphics/TextureFactory';
import type { PaintFinish } from './VehicleSpecs';

export function makePaint(color: string, finish: PaintFinish): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color) });
  applyFinish(m, finish);
  return m;
}

export function applyFinish(m: THREE.MeshPhysicalMaterial, finish: PaintFinish): void {
  m.clearcoat = 1;
  m.clearcoatRoughness = 0.07;
  m.iridescence = 0;
  m.envMapIntensity = 1.25;
  m.normalMap = null;
  switch (finish) {
    case 'metallic':
      m.metalness = 0.72;
      m.roughness = 0.34;
      m.normalMap = noiseNormal('flake', 128, 0.6, 17, 0);
      m.normalScale.set(0.08, 0.08);
      break;
    case 'gloss':
      m.metalness = 0.08;
      m.roughness = 0.16;
      break;
    case 'pearl':
      m.metalness = 0.45;
      m.roughness = 0.26;
      m.iridescence = 1;
      m.iridescenceIOR = 1.7;
      m.iridescenceThicknessRange = [180, 520];
      break;
    case 'matte':
      m.metalness = 0.38;
      m.roughness = 0.62;
      m.clearcoat = 0;
      break;
    case 'chrome':
      m.metalness = 1;
      m.roughness = 0.07;
      m.clearcoat = 0.6;
      m.envMapIntensity = 1.5;
      break;
  }
  m.needsUpdate = true;
}

export interface SharedCarMaterials {
  glass: THREE.MeshPhysicalMaterial;
  glassOpaque: THREE.MeshPhysicalMaterial;
  under: THREE.MeshStandardMaterial;
  tailPanel: THREE.MeshStandardMaterial;
  carbon: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  brakeDisc: THREE.MeshStandardMaterial;
  interior: THREE.MeshStandardMaterial;
  darkChrome: THREE.MeshStandardMaterial;
  screen: THREE.MeshBasicMaterial;
}

let shared: SharedCarMaterials | null = null;

export function sharedCarMaterials(): SharedCarMaterials {
  if (shared) return shared;
  const carbon = carbonFiber();
  shared = {
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0b0e14,
      metalness: 0.1,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.62,
      envMapIntensity: 1.6,
      side: THREE.FrontSide,
    }),
    glassOpaque: new THREE.MeshPhysicalMaterial({
      color: 0x080a0e,
      metalness: 0.2,
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.6,
    }),
    under: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.55, metalness: 0.35, map: carbon }),
    tailPanel: new THREE.MeshStandardMaterial({ color: 0x0d0e11, roughness: 0.22, metalness: 0.7 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.45, map: carbon }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.88, metalness: 0.0, map: tireTexture() }),
    brakeDisc: new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.38, metalness: 0.95 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7, metalness: 0.1 }),
    darkChrome: new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.18, metalness: 1 }),
    screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x29e8ff).multiplyScalar(1.6), toneMapped: false }),
  };
  return shared;
}

/** Emissive "LED" material (values > 1 drive bloom). */
export function ledMaterial(color: string | THREE.Color, intensity: number, additive = false): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({
    color: c,
    toneMapped: false,
    transparent: additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
    side: THREE.DoubleSide,
  });
}

/** Additive glow material with soft radial falloff (for thrusters / underglow). */
export function glowDiscMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        a = a * a;
        gl_FragColor = vec4(uColor * uIntensity * a, a * min(uIntensity, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Animated exhaust / thruster flame: cone geometry with uv.y along length. */
export function flameMaterial(core: string, outer: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0 },
      uCore: { value: new THREE.Color(core) },
      uOuter: { value: new THREE.Color(outer) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uPower; uniform vec3 uCore; uniform vec3 uOuter; varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float along = vUv.y;                  // 0 at nozzle (cone base), 1 at tip
        float around = vUv.x;
        float flick = 0.75 + 0.25 * sin(uTime * 61.0 + around * 18.0) * sin(uTime * 37.0 + along * 9.0);
        float diamonds = 0.65 + 0.35 * smoothstep(0.3, 1.0, sin(along * 28.0 - uTime * 90.0));
        float fade = pow(1.0 - along, 1.6);
        vec3 col = mix(uOuter, uCore, pow(1.0 - along, 3.0));
        float a = fade * flick * diamonds * uPower;
        gl_FragColor = vec4(col * a * 3.0, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
