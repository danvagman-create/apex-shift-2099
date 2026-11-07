import type { Track } from '../track/Track';
import { formatTime, ordinal } from '../core/utils';

export interface HudFrame {
  speedKmh: number;
  rpm: number;
  gear: number;
  nitro: number;
  nitroActive: boolean;
  transform: number;
  targetHover: boolean;
  position: number;
  total: number;
  lap: number;
  laps: number;
  raceTime: number;
  lapTime: number;
  bestLap: number;
  lastLap: number | null;
  gapAhead: number | null;
  gapBehind: number | null;
  aheadName: string | null;
  behindName: string | null;
  standings: { short: string; isPlayer: boolean; finished: boolean; gap: number | null }[];
  cars: { x: number; z: number; isPlayer: boolean; color: string }[];
  heading: number;
  wrongWay: boolean;
  drift: number;
  inHoverLane: boolean;
  onShortcut: boolean;
  draft: number;
  behind: { side: number; dist: number; name: string }[];
  tags: { x: number; y: number; label: string; pos: number; dist: number }[];
  delta: number | null;
  airborne: boolean;
}

export interface HudOptions {
  track: Track;
  units: 'kmh' | 'mph';
  showFps: boolean;
  minimap: boolean;
  mode: string;
  laps: number;
}

const ARC_LEN = 377; // matches SVG path length used in CSS dasharray

/** DOM based racing HUD (cheap text updates only when values change). */
export class HUD {
  private root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private mapCanvas: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private mapBase: HTMLCanvasElement;
  private mapXf = { cx: 0, cz: 0, scale: 1 };
  private toastTimer = 0;
  private bannerTimer = 0;
  private countTimer = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private tagPool: HTMLElement[] = [];
  private arrowPool: HTMLElement[] = [];

  constructor(
    parent: HTMLElement,
    private readonly opts: HudOptions,
  ) {
    const r = document.createElement('div');
    r.className = 'hud hidden';
    r.innerHTML = `
      <div class="hud-tl">
        <div class="hud-pos"><span data-k="pos">1</span><small data-k="posSuffix">ST</small><em>/<span data-k="total">8</span></em></div>
        <div class="hud-gaps">
          <div class="gap ahead"><span data-k="aheadName">—</span><b data-k="gapAhead"></b></div>
          <div class="gap behind"><span data-k="behindName">—</span><b data-k="gapBehind"></b></div>
        </div>
      </div>
      <div class="hud-tc">
        <div class="hud-lap">LAP <b data-k="lap">1</b>/<span data-k="laps">3</span></div>
        <div class="hud-time" data-k="time">0:00.000</div>
        <div class="hud-sub"><span>LAP <b data-k="lapTime">0:00.000</b></span><span>BEST <b data-k="best">--:--.---</b></span></div>
        <div class="hud-delta" data-k="delta"></div>
      </div>
      <div class="hud-standings" data-k="standings"></div>
      <div class="hud-map ${this.opts.minimap ? '' : 'hidden'}"><canvas width="240" height="240"></canvas></div>
      <div class="hud-br">
        <div class="speedo">
          <svg viewBox="0 0 200 200">
            <defs><linearGradient id="spdGrad" x1="0" x2="1"><stop offset="0" stop-color="#29e8ff"/><stop offset="0.7" stop-color="#7a5cff"/><stop offset="1" stop-color="#ff2d95"/></linearGradient></defs>
            <path class="arc-bg" d="M 40 160 A 80 80 0 1 1 160 160" />
            <path class="arc-fg" data-k="arc" d="M 40 160 A 80 80 0 1 1 160 160" />
            <path class="arc-rpm" data-k="rpmArc" d="M 52 150 A 66 66 0 1 1 148 150" />
          </svg>
          <div class="speed-num" data-k="speed">0</div>
          <div class="speed-unit">${this.opts.units === 'mph' ? 'MPH' : 'KM/H'}</div>
          <div class="gear">G<b data-k="gear">1</b></div>
        </div>
        <div class="hud-modes">
          <div class="mode-chip" data-k="mode">ROAD</div>
          <div class="transform-bar"><i data-k="transform"></i></div>
        </div>
        <div class="nitro">
          <div class="nitro-label">NITRO</div>
          <div class="nitro-cells" data-k="nitroCells">${'<i></i>'.repeat(12)}</div>
        </div>
      </div>
      <div class="hud-center">
        <div class="hud-count" data-k="count"></div>
        <div class="hud-banner" data-k="banner"></div>
        <div class="hud-wrong" data-k="wrong">WRONG WAY</div>
      </div>
      <div class="hud-toast" data-k="toast"></div>
      <div class="hud-flags"><span data-k="laneFlag">HOVER LANE · NITRO CHARGING</span><span data-k="draftFlag">SLIPSTREAM</span><span data-k="airFlag">AIRBORNE</span></div>
      <div class="hud-arrows" data-k="arrows"></div>
      <div class="hud-tags" data-k="tags"></div>
      <div class="hud-fps ${this.opts.showFps ? '' : 'hidden'}" data-k="fps"></div>
    `;
    parent.appendChild(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k!] = e));
    this.mapCanvas = r.querySelector('.hud-map canvas') as HTMLCanvasElement;
    this.mapCtx = this.mapCanvas.getContext('2d')!;
    this.mapBase = document.createElement('canvas');
    this.mapBase.width = this.mapBase.height = 240;
    this.drawMapBase();
    this.set('laps', String(opts.laps));
  }

  private set(k: string, v: string): void {
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.el[k].textContent = v;
  }

  private toggle(k: string, on: boolean): void {
    const key = `__${k}`;
    const v = on ? '1' : '0';
    if (this.last[key] === v) return;
    this.last[key] = v;
    this.el[k].classList.toggle('on', on);
  }

  show(): void {
    this.root.classList.remove('hidden');
  }
  hide(): void {
    this.root.classList.add('hidden');
  }

  private drawMapBase(): void {
    const t = this.opts.track;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of t.main.samples) {
      minX = Math.min(minX, s.pos.x);
      maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z);
      maxZ = Math.max(maxZ, s.pos.z);
    }
    const size = Math.max(maxX - minX, maxZ - minZ);
    this.mapXf = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, scale: 200 / size };
    const ctx = this.mapBase.getContext('2d')!;
    ctx.clearRect(0, 0, 240, 240);
    const drawPath = (pts: { x: number; z: number }[], closed: boolean, w: number, col: string, dash?: number[]) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = this.mapPt(p.x, p.z);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (closed) ctx.closePath();
      ctx.lineWidth = w;
      ctx.strokeStyle = col;
      ctx.setLineDash(dash ?? []);
      ctx.lineJoin = 'round';
      ctx.stroke();
    };
    const main = t.main.samples.filter((_, i) => i % 3 === 0).map((s) => ({ x: s.pos.x, z: s.pos.z }));
    drawPath(main, true, 9, 'rgba(0,0,0,0.55)');
    drawPath(main, true, 5, 'rgba(220,235,255,0.55)');
    drawPath(main, true, 1.5, 'rgba(255,255,255,0.95)');
    for (const b of t.branches) {
      const pts = b.samples.filter((_, i) => i % 3 === 0).map((s) => ({ x: s.pos.x, z: s.pos.z }));
      drawPath(pts, false, 3, 'rgba(41,232,255,0.9)', [6, 5]);
    }
    const s0 = t.main.samples[0];
    const [sx, sy] = this.mapPt(s0.pos.x, s0.pos.z);
    ctx.fillStyle = '#ff2d95';
    ctx.fillRect(sx - 4, sy - 4, 8, 8);
  }

  /** World (x,z) to minimap pixels. Screen right = world -X when viewed from above. */
  private mapPt(x: number, z: number): [number, number] {
    const f = this.mapXf;
    return [120 - (x - f.cx) * f.scale, 120 - (z - f.cz) * f.scale];
  }

  countdown(text: string): void {
    const e = this.el.count;
    e.textContent = text;
    e.classList.remove('pop');
    void e.offsetWidth;
    e.classList.add('pop');
    this.countTimer = text === 'GO!' ? 1.1 : 0.95;
  }

  banner(text: string, style: string): void {
    const e = this.el.banner;
    e.textContent = text;
    e.className = `hud-banner show ${style}`;
    this.bannerTimer = 2.6;
  }

  toast(text: string, style: string, dur = 1.6): void {
    const e = this.el.toast;
    e.textContent = text;
    e.className = `hud-toast show ${style}`;
    this.toastTimer = dur;
  }

  update(dt: number, f: HudFrame): void {
    // timers
    if (this.countTimer > 0) {
      this.countTimer -= dt;
      if (this.countTimer <= 0) this.el.count.classList.remove('pop');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
    // fps
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.set('fps', `${Math.round(this.fpsFrames / this.fpsAcc)} FPS`);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    const mph = this.opts.units === 'mph';
    const spd = mph ? f.speedKmh * 0.621371 : f.speedKmh;
    this.set('speed', String(Math.round(spd)));
    this.set('gear', f.transform > 0.5 ? 'H' : String(f.gear));
    const frac = Math.min(1, f.speedKmh / 480);
    this.el.arc.style.strokeDashoffset = String(ARC_LEN * (1 - frac));
    this.el.rpmArc.style.strokeDashoffset = String(310 * (1 - f.rpm));
    this.toggle('arc', f.nitroActive);
    // nitro cells
    const cells = this.el.nitroCells.children;
    const lit = Math.round(f.nitro * cells.length);
    const key = `${lit}-${f.nitroActive}`;
    if (this.last.nitro !== key) {
      this.last.nitro = key;
      for (let i = 0; i < cells.length; i++) (cells[i] as HTMLElement).className = i < lit ? (f.nitroActive ? 'on burn' : 'on') : '';
    }
    // mode
    const hover = f.targetHover;
    this.set('mode', f.transform > 0.02 && f.transform < 0.98 ? 'SHIFTING' : hover ? 'HOVER' : 'ROAD');
    this.toggle('mode', hover);
    this.el.transform.style.transform = `scaleX(${f.transform.toFixed(3)})`;
    // position & laps
    this.set('pos', String(f.position));
    this.set('posSuffix', ordinal(f.position).replace(/^\d+/, ''));
    this.set('total', String(f.total));
    this.set('lap', String(f.lap));
    this.set('time', formatTime(f.raceTime));
    this.set('lapTime', formatTime(f.lapTime));
    this.set('best', formatTime(isFinite(f.bestLap) ? f.bestLap : null));
    this.set('aheadName', f.aheadName ?? '—');
    this.set('behindName', f.behindName ?? '—');
    this.set('gapAhead', f.gapAhead !== null ? `+${Math.abs(f.gapAhead).toFixed(2)}` : '');
    this.set('gapBehind', f.gapBehind !== null ? `-${Math.abs(f.gapBehind).toFixed(2)}` : '');
    if (f.delta !== null) {
      this.set('delta', `${f.delta <= 0 ? '−' : '+'}${Math.abs(f.delta).toFixed(2)}`);
      this.el.delta.className = `hud-delta ${f.delta <= 0 ? 'good' : 'bad'}`;
    } else this.set('delta', '');
    this.toggle('wrong', f.wrongWay);
    this.toggle('laneFlag', f.inHoverLane);
    this.toggle('draftFlag', f.draft > 0.35);
    this.toggle('airFlag', f.airborne);
    // standings (update ~5x/s)
    const st = f.standings.map((s, i) => `${i}|${s.short}|${s.isPlayer ? 1 : 0}|${s.gap === null ? '' : s.gap.toFixed(1)}`).join(',');
    if (this.last.st !== st && (this.fpsFrames % 6 === 0 || !this.last.st)) {
      this.last.st = st;
      this.el.standings.innerHTML = f.standings
        .map((s, i) => `<div class="row ${s.isPlayer ? 'me' : ''}"><b>${i + 1}</b><span>${s.short}</span><em>${s.gap === null ? 'LEADER' : s.finished ? 'FIN' : `+${s.gap.toFixed(1)}`}</em></div>`)
        .join('');
    }
    // minimap
    if (this.opts.minimap) {
      const c = this.mapCtx;
      c.clearRect(0, 0, 240, 240);
      c.drawImage(this.mapBase, 0, 0);
      for (const car of f.cars) {
        if (car.isPlayer) continue;
        const [x, y] = this.mapPt(car.x, car.z);
        c.fillStyle = car.color;
        c.beginPath();
        c.arc(x, y, 4, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.7)';
        c.lineWidth = 1;
        c.stroke();
      }
      const me = f.cars.find((x) => x.isPlayer);
      if (me) {
        const [x, y] = this.mapPt(me.x, me.z);
        c.save();
        c.translate(x, y);
        // heading: forward (sin h, cos h) in world -> screen (-sin h, -cos h)
        c.rotate(Math.atan2(-Math.cos(f.heading), -Math.sin(f.heading)));
        c.fillStyle = '#ffffff';
        c.shadowColor = '#29e8ff';
        c.shadowBlur = 8;
        c.beginPath();
        c.moveTo(8, 0);
        c.lineTo(-6, 5);
        c.lineTo(-3, 0);
        c.lineTo(-6, -5);
        c.closePath();
        c.fill();
        c.restore();
      }
    }
    // proximity arrows
    this.syncPool(this.arrowPool, f.behind.length, this.el.arrows, 'arrow');
    f.behind.forEach((b, i) => {
      const a = this.arrowPool[i];
      const x = 50 + b.side * 38;
      a.style.left = `${x}%`;
      a.style.opacity = String(Math.max(0.25, 1 - b.dist / 40));
      a.textContent = `▲ ${b.name} ${b.dist.toFixed(0)}m`;
    });
    // name tags
    const tags = f.tags.filter((t) => t.x > -5 && t.x < 105 && t.y > -5 && t.y < 105);
    this.syncPool(this.tagPool, tags.length, this.el.tags, 'tag');
    tags.forEach((t, i) => {
      const e = this.tagPool[i];
      e.style.transform = `translate(${t.x}vw, ${t.y}vh) translate(-50%, -100%)`;
      e.style.opacity = String(Math.max(0.2, 1 - t.dist / 120));
      const txt = `${t.pos} ${t.label}`;
      if (e.textContent !== txt) e.textContent = txt;
    });
  }

  private syncPool(pool: HTMLElement[], n: number, parent: HTMLElement, cls: string): void {
    while (pool.length < n) {
      const e = document.createElement('div');
      e.className = cls;
      parent.appendChild(e);
      pool.push(e);
    }
    pool.forEach((e, i) => (e.style.display = i < n ? '' : 'none'));
  }

  setFpsVisible(v: boolean): void {
    this.el.fps.classList.toggle('hidden', !v);
  }

  dispose(): void {
    this.root.remove();
  }
}
