import * as THREE from 'three';

export type SkyTheme = 'tokyo' | 'canyon' | 'skyline' | 'showroom';

export interface SkyColors {
  top: string;
  horizon: string;
  bottom: string;
  glow: string;
  sun: string;
  sunDir: [number, number, number];
  sunSize: number;
  stars: number;
  clouds: number;
}

export const SKY_PRESETS: Record<SkyTheme, SkyColors> = {
  tokyo: { top: '#020309', horizon: '#1b1030', bottom: '#040406', glow: '#4a1650', sun: '#9fb8ff', sunDir: [0.4, 0.45, -0.8], sunSize: 0.35, stars: 0.35, clouds: 0.25 },
  canyon: { top: '#24306a', horizon: '#ff8a3d', bottom: '#3a1d14', glow: '#ffb070', sun: '#ffd9a0', sunDir: [-0.6, 0.08, -0.79], sunSize: 1.2, stars: 0.0, clouds: 0.35 },
  skyline: { top: '#2a63c9', horizon: '#f6cfa2', bottom: '#e9dccf', glow: '#ffd7a8', sun: '#fff1d0', sunDir: [0.55, 0.22, -0.8], sunSize: 1.0, stars: 0.0, clouds: 0.6 },
  showroom: { top: '#07080b', horizon: '#0e1016', bottom: '#050506', glow: '#101522', sun: '#ffffff', sunDir: [0, 1, 0], sunSize: 0, stars: 0, clouds: 0 },
};

export function createSkyMaterial(c: SkyColors): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(c.top) },
      uHorizon: { value: new THREE.Color(c.horizon) },
      uBottom: { value: new THREE.Color(c.bottom) },
      uGlow: { value: new THREE.Color(c.glow) },
      uSun: { value: new THREE.Color(c.sun) },
      uSunDir: { value: new THREE.Vector3(...c.sunDir).normalize() },
      uSunSize: { value: c.sunSize },
      uStars: { value: c.stars },
      uClouds: { value: c.clouds },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uBottom, uGlow, uSun, uSunDir;
      uniform float uSunSize, uStars, uClouds, uTime;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.45)) : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.35));
        col += uGlow * exp(-abs(h) * 9.0) * 0.6;
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(sd, 1400.0) * 40.0 * uSunSize + pow(sd, 18.0) * 0.45 * uSunSize + pow(sd, 3.0) * 0.12 * uSunSize);
        if (uStars > 0.0 && h > 0.02) {
          vec3 p = floor(d * 420.0);
          float s = hash(p);
          col += vec3(step(0.9982, s) * uStars * smoothstep(0.02, 0.4, h) * (0.5 + 0.5 * sin(uTime * 2.0 + s * 100.0)));
        }
        if (uClouds > 0.0) {
          vec2 cp = d.xz / max(abs(h) + 0.12, 0.05);
          float n = fbm(cp * 1.4 + vec2(uTime * 0.01, 0.0));
          float band = h > 0.0 ? smoothstep(0.55, 0.0, h) : smoothstep(-0.7, -0.02, h) * 1.4;
          float cl = smoothstep(0.45, 0.85, n) * band * uClouds;
          vec3 cloudCol = mix(uHorizon * 1.05, vec3(1.0), 0.35) + uSun * pow(sd, 6.0) * 0.4;
          col = mix(col, cloudCol, clamp(cl, 0.0, 0.85));
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
}

export function createSky(theme: SkyTheme, radius = 4000): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), createSkyMaterial(SKY_PRESETS[theme]));
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return mesh;
}
