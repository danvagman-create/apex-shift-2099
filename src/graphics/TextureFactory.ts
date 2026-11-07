import * as THREE from 'three';
import { Rng } from '../core/utils';

/** Procedural canvas textures generated at runtime (no external image assets). */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const t = make();
  cache.set(key, t);
  return t;
}

export function disposeTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

/** Noise speckle helper writing into ImageData. */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, seed: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const rng = new Rng(seed);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.float() - 0.5) * amp + (rng.float() < 0.02 ? amp * 0.8 : 0);
    d[i] = Math.max(0, Math.min(255, base[0] + n));
    d[i + 1] = Math.max(0, Math.min(255, base[1] + n));
    d[i + 2] = Math.max(0, Math.min(255, base[2] + n));
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export interface RoadStyle {
  base: [number, number, number];
  line: string;
  edge: string;
  lanes: number;
  wet: boolean;
}

export const ROAD_STYLES: Record<string, RoadStyle> = {
  tokyo: { base: [44, 45, 52], line: 'rgba(245,248,255,0.95)', edge: 'rgba(255,255,255,1)', lanes: 4, wet: true },
  canyon: { base: [64, 52, 46], line: 'rgba(255,230,200,0.75)', edge: 'rgba(255,140,40,0.95)', lanes: 3, wet: false },
  skyline: { base: [34, 38, 48], line: 'rgba(170,240,255,0.8)', edge: 'rgba(80,230,255,0.95)', lanes: 4, wet: false },
};

/** Asphalt color map: u across road, v along (tiles every 24 m). */
export function roadTexture(theme: string): THREE.CanvasTexture {
  return cached(`road-${theme}`, () => {
    const st = ROAD_STYLES[theme] ?? ROAD_STYLES.tokyo;
    const W = 512;
    const H = 1024;
    const [c, ctx] = canvas(W, H);
    speckle(ctx, W, H, st.base, 26, 11);
    // aggregate patches / tire wear
    const rng = new Rng(5);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${rng.float() < 0.5 ? '0,0,0' : '255,255,255'},${rng.range(0.015, 0.05)})`;
      ctx.beginPath();
      ctx.ellipse(rng.range(0, W), rng.range(0, H), rng.range(10, 60), rng.range(20, 140), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // racing-line rubber
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0.0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.3, 'rgba(0,0,0,0.12)');
    grad.addColorStop(0.42, 'rgba(0,0,0,0.0)');
    grad.addColorStop(0.58, 'rgba(0,0,0,0.0)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.12)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // edge lines
    ctx.fillStyle = st.edge;
    ctx.fillRect(W * 0.025, 0, W * 0.012, H);
    ctx.fillRect(W * 0.963, 0, W * 0.012, H);
    return tex(c);
  });
}

/** Roughness map: puddles (dark = glossy) for wet roads. */
export function roadRoughness(theme: string): THREE.CanvasTexture {
  return cached(`roadR-${theme}`, () => {
    const st = ROAD_STYLES[theme] ?? ROAD_STYLES.tokyo;
    const W = 256;
    const H = 512;
    const [c, ctx] = canvas(W, H);
    const base = st.wet ? 150 : 200;
    speckle(ctx, W, H, [base, base, base], 30, 21);
    if (st.wet) {
      const rng = new Rng(9);
      for (let i = 0; i < 70; i++) {
        const x = rng.range(0, W);
        const y = rng.range(0, H);
        const r = rng.range(8, 46);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(40,40,40,0.9)');
        g.addColorStop(1, 'rgba(10,10,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * rng.range(1, 2.5), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // painted lines are smoother
    ctx.fillStyle = 'rgba(60,60,60,0.8)';
    ctx.fillRect(W * 0.025, 0, W * 0.012, H);
    ctx.fillRect(W * 0.963, 0, W * 0.012, H);
    return tex(c, false);
  });
}

/** Tangent-space normal map derived from a noise heightfield. */
export function noiseNormal(key: string, size = 256, strength = 2, seed = 3, scale = 1): THREE.CanvasTexture {
  return cached(`nrm-${key}`, () => {
    const [c, ctx] = canvas(size, size);
    const rng = new Rng(seed);
    const hgt = new Float32Array(size * size);
    for (let i = 0; i < hgt.length; i++) hgt[i] = rng.float();
    // blur a little for coherent bumps
    const blur = (src: Float32Array) => {
      const out = new Float32Array(src.length);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          let s = 0;
          for (let k = -1; k <= 1; k++)
            for (let j = -1; j <= 1; j++) s += src[((y + k + size) % size) * size + ((x + j + size) % size)];
          out[y * size + x] = s / 9;
        }
      return out;
    };
    let h = hgt;
    for (let i = 0; i < Math.round(scale); i++) h = blur(h);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const l = h[y * size + ((x - 1 + size) % size)];
        const r = h[y * size + ((x + 1) % size)];
        const u = h[((y - 1 + size) % size) * size + x];
        const d = h[((y + 1) % size) * size + x];
        let nx = (l - r) * strength;
        let ny = (u - d) * strength;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        const i = (y * size + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return tex(c, false);
  });
}

export function carbonFiber(): THREE.CanvasTexture {
  return cached('carbon', () => {
    const S = 128;
    const [c, ctx] = canvas(S, S);
    ctx.fillStyle = '#0d0e10';
    ctx.fillRect(0, 0, S, S);
    const cell = 16;
    for (let y = 0; y < S; y += cell)
      for (let x = 0; x < S; x += cell) {
        const odd = (x / cell + y / cell) % 2 === 0;
        const g = odd ? ctx.createLinearGradient(x, y, x + cell, y) : ctx.createLinearGradient(x, y, x, y + cell);
        g.addColorStop(0, '#16181c');
        g.addColorStop(0.5, '#2a2d33');
        g.addColorStop(1, '#121316');
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }
    const t = tex(c);
    t.repeat.set(6, 6);
    return t;
  });
}

/** Radial soft glow sprite (white, alpha falloff). */
export function glowSprite(): THREE.CanvasTexture {
  return cached('glow', () => {
    const S = 128;
    const [c, ctx] = canvas(S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return tex(c, true, false);
  });
}

/** Soft smoke puff sprite. */
export function smokeSprite(): THREE.CanvasTexture {
  return cached('smoke', () => {
    const S = 128;
    const [c, ctx] = canvas(S, S);
    const rng = new Rng(4);
    for (let i = 0; i < 26; i++) {
      const x = S / 2 + rng.range(-22, 22);
      const y = S / 2 + rng.range(-22, 22);
      const r = rng.range(18, 40);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    return tex(c, true, false);
  });
}

export function checkerTexture(): THREE.CanvasTexture {
  return cached('checker', () => {
    const [c, ctx] = canvas(256, 64);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 16; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    return tex(c);
  });
}

/** Hexagon grid (energy barriers / holo floors). White on transparent. */
export function hexTexture(): THREE.CanvasTexture {
  return cached('hex', () => {
    const W = 256;
    const H = 222;
    const [c, ctx] = canvas(W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    const r = 32;
    const hh = Math.sqrt(3) * r;
    for (let row = -1; row < 5; row++)
      for (let col = -1; col < 6; col++) {
        const cx = col * r * 1.5;
        const cy = row * hh + (col % 2 ? hh / 2 : 0);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    return tex(c);
  });
}

/** Neutral gray detail texture (multiplies vertex colors on terrain). */
export function detailTexture(): THREE.CanvasTexture {
  return cached('detail', () => {
    const S = 512;
    const [c, ctx] = canvas(S, S);
    speckle(ctx, S, S, [205, 205, 205], 50, 41);
    const rng = new Rng(19);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '0,0,0'},${rng.range(0.03, 0.09)})`;
      ctx.beginPath();
      ctx.ellipse(rng.range(0, S), rng.range(0, S), rng.range(4, 40), rng.range(2, 12), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    return tex(c);
  });
}

/** Lane markings only (white on black) – used as an emissive map so paint reads at night. */
export function roadMarkings(theme: string): THREE.CanvasTexture {
  return cached(`roadE-${theme}`, () => {
    const st = ROAD_STYLES[theme] ?? ROAD_STYLES.tokyo;
    const W = 512;
    const H = 1024;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = st.edge;
    ctx.fillRect(W * 0.025, 0, W * 0.012, H);
    ctx.fillRect(W * 0.963, 0, W * 0.012, H);
    ctx.fillStyle = st.line;
    for (let l = 1; l < st.lanes; l++) {
      const x = (W * l) / st.lanes - 3;
      for (let y = 0; y < H; y += 256) ctx.fillRect(x, y + 20, 6, 120);
    }
    return tex(c);
  });
}

/** Rock / sandstone color texture with strata. */
export function rockTexture(): THREE.CanvasTexture {
  return cached('rock', () => {
    const S = 512;
    const [c, ctx] = canvas(S, S);
    speckle(ctx, S, S, [150, 78, 48], 40, 31);
    const rng = new Rng(13);
    for (let y = 0; y < S; y += 2) {
      const k = Math.sin(y * 0.09) * 0.5 + Math.sin(y * 0.031 + 1.3) * 0.5;
      ctx.fillStyle = `rgba(${k > 0 ? '255,170,110' : '60,25,15'},${Math.abs(k) * 0.12})`;
      ctx.fillRect(0, y, S, 2);
    }
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.03, 0.1)})`;
      ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(2, 30), rng.range(1, 4));
    }
    return tex(c);
  });
}

const SIGN_WORDS = [
  'APEX', 'ネオン', '東京', 'KAIYO', 'スピード', 'NEXUS', '2099', 'VOLT', 'SYNTH', 'HYPER',
  '未来', 'ZEN-TEC', 'ORION', 'ラーメン', 'LUMEN', 'カフェ', 'NOVA', '電気', 'DRIFT', 'HOTEL',
  'GRAV', '夜', 'PULSE', 'SHIFT', 'ECLIPSE', 'バー', 'RYU', 'MOTO', 'CYBER', '24H', 'NEON', 'ARCADE',
];
const SIGN_COLORS = ['#ff2d95', '#29e8ff', '#ffb000', '#a6ff00', '#b18cff', '#ff3b30', '#00ffc6', '#ffffff'];

/** Atlas of neon signs: 4 columns x 8 rows, each cell 512x256. */
export function neonSignAtlas(): { texture: THREE.CanvasTexture; cols: number; rows: number } {
  const t = cached('neonAtlas', () => {
    const cols = 4;
    const rows = 8;
    const CW = 512;
    const CH = 256;
    const [c, ctx] = canvas(cols * CW, rows * CH);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const rng = new Rng(77);
    for (let i = 0; i < cols * rows; i++) {
      const x = (i % cols) * CW;
      const y = Math.floor(i / cols) * CH;
      const word = SIGN_WORDS[i % SIGN_WORDS.length];
      const col = SIGN_COLORS[i % SIGN_COLORS.length];
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, CW, CH);
      ctx.clip();
      // frame
      ctx.strokeStyle = col;
      ctx.lineWidth = 6;
      ctx.shadowColor = col;
      ctx.shadowBlur = 24;
      if (rng.float() < 0.6) ctx.strokeRect(x + 18, y + 18, CW - 36, CH - 36);
      const cjk = /[^\x00-\x7F]/.test(word);
      const size = cjk ? 150 : word.length > 5 ? 110 : 140;
      ctx.font = `900 ${size}px ${cjk ? '"Yu Gothic","Meiryo","Hiragino Sans","Noto Sans CJK JP",sans-serif' : '"Orbitron","Arial Black",sans-serif'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = col;
      for (let k = 0; k < 3; k++) ctx.fillText(word, x + CW / 2, y + CH / 2 + 8);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `900 ${size * 0.96}px ${cjk ? '"Yu Gothic","Meiryo",sans-serif' : '"Orbitron","Arial Black",sans-serif'}`;
      ctx.globalAlpha = 0.55;
      ctx.fillText(word, x + CW / 2, y + CH / 2 + 8);
      ctx.restore();
    }
    const tx = tex(c, true, false);
    tx.generateMipmaps = true;
    return tx;
  });
  return { texture: t, cols: 4, rows: 8 };
}

/** Logo / billboard texture with text lines. */
export function billboardTexture(lines: string[], color: string, bg = '#05060a'): THREE.CanvasTexture {
  return cached(`bb-${lines.join('|')}-${color}`, () => {
    const [c, ctx] = canvas(1024, 512);
    const g = ctx.createLinearGradient(0, 0, 1024, 512);
    g.addColorStop(0, bg);
    g.addColorStop(1, '#10131c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.strokeRect(20, 20, 984, 472);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.font = `900 ${i === 0 ? 130 : 56}px "Orbitron","Arial Black",sans-serif`;
      ctx.fillText(l, 512, 200 + i * 140);
    });
    return tex(c, true, false);
  });
}

/** Simple vertical gradient strip texture. */
export function gradientTexture(stops: [number, string][], key: string): THREE.CanvasTexture {
  return cached(`grad-${key}`, () => {
    const [c, ctx] = canvas(4, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    for (const [o, col] of stops) g.addColorStop(o, col);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    return tex(c, true, false);
  });
}

/** Tire tread pattern (grayscale color map). */
export function tireTexture(): THREE.CanvasTexture {
  return cached('tire', () => {
    const [c, ctx] = canvas(256, 64);
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#0a0a0a';
    for (let x = 0; x < 256; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x + 8, 32);
      ctx.lineTo(x, 56);
      ctx.lineTo(x + 4, 56);
      ctx.lineTo(x + 12, 32);
      ctx.lineTo(x + 4, 8);
      ctx.fill();
    }
    ctx.fillRect(0, 30, 256, 4);
    const t = tex(c);
    t.repeat.set(6, 1);
    return t;
  });
}
