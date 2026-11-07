import type { RenderContext } from './RenderContext';

/** Lightweight FPS / frame-time / draw-call overlay (toggle with F3 or settings). */
export class PerfMonitor {
  private el: HTMLElement;
  private acc = 0;
  private frames = 0;
  private worst = 0;
  visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'perf';
    parent.appendChild(this.el);
  }

  tick(dt: number, ctx: RenderContext): void {
    this.el.style.display = this.visible ? '' : 'none';
    this.acc += dt;
    this.frames++;
    this.worst = Math.max(this.worst, dt);
    if (this.acc < 0.5) return;
    if (this.visible) {
      const s = ctx.stats();
      const fps = this.frames / this.acc;
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      this.el.textContent =
        `${fps.toFixed(0)} FPS  ${((this.acc / this.frames) * 1000).toFixed(1)}ms (max ${(this.worst * 1000).toFixed(0)})\n` +
        `${s.calls} DRAWS  ${(s.triangles / 1000).toFixed(0)}K TRIS\n` +
        `${s.geometries} GEO  ${s.textures} TEX  ${ctx.preset.toUpperCase()}` +
        (mem ? `\nHEAP ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '');
    }
    this.acc = 0;
    this.frames = 0;
    this.worst = 0;
  }
}
