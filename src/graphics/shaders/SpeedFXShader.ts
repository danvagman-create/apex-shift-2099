import * as THREE from 'three';

/**
 * Combined speed effects pass (runs in linear HDR before tone mapping):
 *  - radial motion blur that leaves the screen center (road ahead) sharp
 *  - chromatic aberration toward the edges
 *  - speed / nitro tinted vignette, film grain, fade-to-black
 */
export function createSpeedFXShader(samples: number) {
  return {
    name: 'SpeedFXShader',
    defines: { SAMPLES: Math.max(1, samples) },
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uStrength: { value: 0 },
      uCenter: { value: new THREE.Vector2(0.5, 0.52) },
      uChroma: { value: 0 },
      uVignette: { value: 0.35 },
      uNitro: { value: 0 },
      uNitroColor: { value: new THREE.Color(0.2, 0.7, 1.0) },
      uTime: { value: 0 },
      uFade: { value: 0 },
      uFlash: { value: 0 },
      uAspect: { value: 1.77 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uStrength;
      uniform vec2 uCenter;
      uniform float uChroma;
      uniform float uVignette;
      uniform float uNitro;
      uniform vec3 uNitroColor;
      uniform float uTime;
      uniform float uFade;
      uniform float uFlash;
      uniform float uAspect;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 dir = vUv - uCenter;
        vec2 ad = vec2(dir.x * uAspect, dir.y);
        float dist = length(ad);
        float mask = smoothstep(0.18, 0.95, dist);
        vec3 col = vec3(0.0);
        float total = 0.0;
        #if SAMPLES > 1
        for (int i = 0; i < SAMPLES; i++) {
          float t = float(i) / float(SAMPLES - 1);
          float scale = 1.0 - uStrength * 0.11 * t * mask;
          float w = 1.0 - t * 0.6;
          col += texture2D(tDiffuse, uCenter + dir * scale).rgb * w;
          total += w;
        }
        col /= total;
        #else
        col = texture2D(tDiffuse, vUv).rgb;
        #endif
        if (uChroma > 0.001) {
          vec2 off = dir * uChroma * 0.014 * mask;
          float r = texture2D(tDiffuse, vUv + off).r;
          float b = texture2D(tDiffuse, vUv - off).b;
          col.r = mix(col.r, r, 0.75);
          col.b = mix(col.b, b, 0.75);
        }
        float vig = smoothstep(1.25, 0.25, dist * (1.0 + uVignette * 0.5));
        col *= mix(1.0, vig, 0.35 + uVignette * 0.45);
        col += uNitroColor * uNitro * mask * mask * 0.35;
        col += (hash(vUv * 731.0 + uTime) - 0.5) * 0.012;
        col += vec3(uFlash);
        col = mix(col, vec3(0.0), uFade);
        gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
      }`,
  };
}
