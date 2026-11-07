import { approach, clamp } from './utils';
import type { DriveInput } from '../vehicles/VehiclePhysics';

export type ActionEdge = 'pause' | 'camera' | 'transform' | 'confirm' | 'back' | 'up' | 'down' | 'left' | 'right' | 'restart' | 'lookBack';

/** Keyboard + Gamepad input with edge-triggered actions. */
export class Input {
  private keys = new Set<string>();
  private edges = new Set<ActionEdge>();
  private padPrev: boolean[] = [];
  private padAxisPrev = { x: 0, y: 0 };
  readonly drive: DriveInput = { throttle: 0, brake: 0, steer: 0, nitro: false, transform: false };
  private steerKb = 0;
  gamepadConnected = false;
  lookBack = false;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      switch (e.code) {
        case 'Escape':
        case 'KeyP':
          this.edges.add('pause');
          break;
        case 'KeyC':
          this.edges.add('camera');
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.edges.add('transform');
          break;
        case 'Enter':
          this.edges.add('confirm');
          break;
        case 'Backspace':
          this.edges.add('back');
          break;
        case 'KeyR':
          this.edges.add('restart');
          break;
        case 'ArrowUp':
          this.edges.add('up');
          break;
        case 'ArrowDown':
          this.edges.add('down');
          break;
        case 'ArrowLeft':
          this.edges.add('left');
          break;
        case 'ArrowRight':
          this.edges.add('right');
          break;
      }
      if (this.isGameKey(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', () => (this.gamepadConnected = true));
    window.addEventListener('gamepaddisconnected', () => (this.gamepadConnected = false));
  }

  private isGameKey(code: string): boolean {
    return ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Tab'].includes(code);
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Consume an edge-triggered action. */
  consume(a: ActionEdge): boolean {
    if (this.edges.has(a)) {
      this.edges.delete(a);
      return true;
    }
    return false;
  }

  clearEdges(): void {
    this.edges.clear();
  }

  private gamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    for (const gp of navigator.getGamepads()) if (gp && gp.connected) return gp;
    return null;
  }

  /** Poll devices; speed (m/s) shapes keyboard steering response. */
  update(dt: number, speed = 0): DriveInput {
    const d = this.drive;
    const gp = this.gamepad();
    this.gamepadConnected = !!gp;
    let throttle = this.key('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = this.key('KeyS', 'ArrowDown') ? 1 : 0;
    const left = this.key('KeyA', 'ArrowLeft');
    const right = this.key('KeyD', 'ArrowRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    // Keyboard steering ramps (faster to center), slower at high speed for stability.
    const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.steerKb) && this.steerKb !== 0 ? 9 : 4.2 - clamp(speed / 120, 0, 1) * 1.6;
    this.steerKb = approach(this.steerKb, target, rate * dt);
    let steer = this.steerKb;
    let nitro = this.key('Space');
    this.lookBack = this.key('KeyQ');

    if (gp) {
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const v = (i: number) => gp.buttons[i]?.value ?? 0;
      const ax = gp.axes[0] ?? 0;
      const dz = 0.12;
      const sx = Math.abs(ax) < dz ? 0 : Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz)) ** 1.5;
      if (Math.abs(sx) > Math.abs(steer)) steer = sx;
      throttle = Math.max(throttle, v(7), b(0) ? 1 : 0);
      brake = Math.max(brake, v(6), b(2) ? 1 : 0);
      nitro = nitro || b(1) || b(5);
      if (b(10)) this.lookBack = true;
      const edgesMap: [number, ActionEdge][] = [
        [9, 'pause'],
        [3, 'camera'],
        [8, 'back'],
        [12, 'up'],
        [13, 'down'],
        [14, 'left'],
        [15, 'right'],
      ];
      for (const [i, a] of edgesMap) if (b(i) && !this.padPrev[i]) this.edges.add(a);
      // Transform: LB or right-stick click. Camera: Y. Nitro: B / RB. Pause: Start.
      if ((b(11) || b(4)) && !this.padPrev[11] && !this.padPrev[4]) this.edges.add('transform');
      if (b(0) && !this.padPrev[0]) this.edges.add('confirm');
      if (b(1) && !this.padPrev[1]) this.edges.add('back');
      // stick-based menu nav
      const ay = gp.axes[1] ?? 0;
      if (ay < -0.6 && this.padAxisPrev.y >= -0.6) this.edges.add('up');
      if (ay > 0.6 && this.padAxisPrev.y <= 0.6) this.edges.add('down');
      if (ax < -0.6 && this.padAxisPrev.x >= -0.6) this.edges.add('left');
      if (ax > 0.6 && this.padAxisPrev.x <= 0.6) this.edges.add('right');
      this.padAxisPrev = { x: ax, y: ay };
      this.padPrev = gp.buttons.map((x) => x.pressed);
    }

    if (!this.enabled) {
      throttle = 0;
      brake = 0;
      steer = 0;
      nitro = false;
    }
    d.throttle = throttle;
    d.brake = brake;
    d.steer = clamp(steer, -1, 1);
    d.nitro = nitro;
    d.transform = this.enabled && this.consume('transform');
    return d;
  }
}
