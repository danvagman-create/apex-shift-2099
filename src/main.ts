import './styles/main.css';
import { Game } from './core/Game';
import { RenderContext } from './core/RenderContext';
import { ShowroomScene } from './scenes/ShowroomScene';
import { getVehicle } from './vehicles/VehicleSpecs';
import type { QualityPreset } from './core/Settings';

const params = new URLSearchParams(location.search);
const viewport = document.getElementById('viewport')!;
const ui = document.getElementById('ui')!;

function showFatal(msg: string): void {
  ui.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:#fff;text-align:center;padding:24px;pointer-events:auto">
    <div><h2 style="letter-spacing:.2em">APEX SHIFT 2099</h2><p>${msg}</p></div></div>`;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  showFatal('WebGL is not available. Please use an up-to-date Chrome or Edge with hardware acceleration enabled.');
} else if (params.has('photo')) {
  // Photo mode: render a single car in the showroom (used for asset review & screenshots).
  const ctx = new RenderContext(viewport, (params.get('q') as QualityPreset) ?? 'high');
  const room = new ShowroomScene(ctx);
  const carId = params.get('photo') || 'vortex';
  const v = getVehicle(carId);
  room.showCar(carId, { paint: params.get('paint') ? `#${params.get('paint')}` : v.colors.paint, finish: 'metallic', accent: v.colors.accent, light: v.colors.light, rim: v.colors.rim, hover: v.colors.hover }, true);
  room.setMode((params.get('mode') as 'menu') ?? 'garage');
  room.carTransformTarget = Number(params.get('hover') ?? 0);
  if (params.has('yaw')) room.setOrbit(Number(params.get('yaw')), Number(params.get('pitch') ?? 0.15), Number(params.get('dist') ?? 7));
  ctx.setScene(room.scene, room.camera);
  ctx.setBloom(0.5, 0.4, 1.0);
  ctx.renderer.toneMappingExposure = 0.95;
  ctx.resize();
  const w = window as unknown as { __ready: boolean; __capture: () => string };
  w.__capture = () => {
    ctx.render(1 / 60);
    return ctx.canvas.toDataURL('image/jpeg', 0.92);
  };
  let frames = 0;
  const maxFrames = Number(params.get('frames') ?? 0);
  const loop = () => {
    room.update(1 / 60);
    ctx.render(1 / 60);
    frames++;
    if (maxFrames && frames >= maxFrames) {
      w.__ready = true;
      return;
    }
    if (frames > 5) w.__ready = true;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else {
  try {
    const game = new Game(viewport, ui);
    game.start();
  } catch (e) {
    console.error(e);
    showFatal(`Failed to start: ${(e as Error).message}`);
  }
}
