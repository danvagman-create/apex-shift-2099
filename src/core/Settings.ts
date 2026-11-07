/** Graphics presets and user settings. */

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY_PRESETS: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

export interface GraphicsConfig {
  /** Max device pixel ratio used by the renderer. */
  pixelRatio: number;
  /** Internal render scale multiplier (1 = native). */
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  postFX: boolean;
  bloom: boolean;
  bloomResolutionScale: number;
  antialias: 'none' | 'fxaa' | 'smaa';
  /** Multiplier for particle counts. */
  particles: number;
  /** Multiplier for scenery density (instances). */
  scenery: number;
  /** Real-time cube reflections for player car. */
  dynamicReflections: boolean;
  /** Mirror floor in the showroom. */
  showroomReflector: boolean;
  /** Real spotlights for player headlights. */
  headlightLights: boolean;
  /** Draw distance (camera far + fog scale). */
  drawDistance: number;
  /** Number of radial blur taps. */
  blurSamples: number;
  anisotropy: number;
}

export const PRESETS: Record<QualityPreset, GraphicsConfig> = {
  low: {
    pixelRatio: 1,
    renderScale: 0.75,
    shadows: false,
    shadowMapSize: 512,
    postFX: false,
    bloom: false,
    bloomResolutionScale: 0.25,
    antialias: 'none',
    particles: 0.35,
    scenery: 0.45,
    dynamicReflections: false,
    showroomReflector: false,
    headlightLights: false,
    drawDistance: 1400,
    blurSamples: 0,
    anisotropy: 1,
  },
  medium: {
    pixelRatio: 1,
    renderScale: 1,
    shadows: true,
    shadowMapSize: 1024,
    postFX: true,
    bloom: true,
    bloomResolutionScale: 0.35,
    antialias: 'fxaa',
    particles: 0.6,
    scenery: 0.7,
    dynamicReflections: false,
    showroomReflector: true,
    headlightLights: false,
    drawDistance: 2200,
    blurSamples: 6,
    anisotropy: 4,
  },
  high: {
    pixelRatio: 1.5,
    renderScale: 1,
    shadows: true,
    shadowMapSize: 2048,
    postFX: true,
    bloom: true,
    bloomResolutionScale: 0.5,
    antialias: 'fxaa',
    particles: 1,
    scenery: 1,
    dynamicReflections: false,
    showroomReflector: true,
    headlightLights: true,
    drawDistance: 3200,
    blurSamples: 10,
    anisotropy: 8,
  },
  ultra: {
    pixelRatio: 2,
    renderScale: 1,
    shadows: true,
    shadowMapSize: 4096,
    postFX: true,
    bloom: true,
    bloomResolutionScale: 0.5,
    antialias: 'smaa',
    particles: 1.4,
    scenery: 1.25,
    dynamicReflections: true,
    showroomReflector: true,
    headlightLights: true,
    drawDistance: 4200,
    blurSamples: 14,
    anisotropy: 16,
  },
};

export type CameraMode = 'chase' | 'far' | 'hood' | 'cockpit';
export const CAMERA_MODES: CameraMode[] = ['chase', 'far', 'hood', 'cockpit'];

export interface UserSettings {
  quality: QualityPreset;
  showFps: boolean;
  motionBlur: number; // 0..1
  cameraShake: number; // 0..1
  dynamicFov: boolean;
  masterVolume: number; // 0..1
  musicVolume: number;
  sfxVolume: number;
  units: 'kmh' | 'mph';
  camera: CameraMode;
  minimap: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  quality: 'high',
  showFps: false,
  motionBlur: 0.7,
  cameraShake: 0.8,
  dynamicFov: true,
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.9,
  units: 'kmh',
  camera: 'chase',
  minimap: true,
};

/** Pick a sensible starting preset from device hints. */
export function suggestPreset(): QualityPreset {
  if (typeof navigator === 'undefined') return 'high';
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
}
