import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { PRESETS, type GraphicsConfig, type QualityPreset } from './Settings';
import { createSpeedFXShader } from '../graphics/shaders/SpeedFXShader';

export interface SpeedFXParams {
  strength: number;
  chroma: number;
  vignette: number;
  nitro: number;
  fade: number;
  flash: number;
  centerY: number;
}

/** Owns the WebGL renderer, post-processing chain and quality presets. */
export class RenderContext {
  readonly renderer: THREE.WebGLRenderer;
  config: GraphicsConfig;
  preset: QualityPreset;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private speedPass: ShaderPass | null = null;
  private aaPass: ShaderPass | SMAAPass | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  readonly fx: SpeedFXParams = { strength: 0, chroma: 0, vignette: 0.35, nitro: 0, fade: 0, flash: 0, centerY: 0.52 };
  bloomStrength = 0.9;
  bloomRadius = 0.55;
  bloomThreshold = 0.82;
  private width = 1;
  private height = 1;
  private time = 0;

  constructor(
    public readonly container: HTMLElement,
    preset: QualityPreset,
  ) {
    this.preset = preset;
    this.config = PRESETS[preset];
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.resize());
    this.applyQuality(preset);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  applyQuality(preset: QualityPreset): void {
    this.preset = preset;
    this.config = PRESETS[preset];
    const c = this.config;
    this.renderer.shadowMap.enabled = c.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.disposeComposer();
    if (c.postFX) this.buildComposer();
    this.resize();
    if (this.scene && this.camera) this.setScene(this.scene, this.camera);
  }

  private buildComposer(): void {
    const c = this.config;
    const composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    if (c.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.bloomStrength, this.bloomRadius, this.bloomThreshold);
      composer.addPass(this.bloom);
    }
    this.speedPass = new ShaderPass(createSpeedFXShader(c.blurSamples));
    composer.addPass(this.speedPass);
    composer.addPass(new OutputPass());
    if (c.antialias === 'fxaa') {
      this.aaPass = new FXAAPass();
      composer.addPass(this.aaPass);
    } else if (c.antialias === 'smaa') {
      this.aaPass = new SMAAPass();
      composer.addPass(this.aaPass);
    }
    this.composer = composer;
  }

  private disposeComposer(): void {
    if (!this.composer) return;
    for (const p of this.composer.passes) (p as unknown as { dispose?: () => void }).dispose?.();
    this.composer.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloom = null;
    this.speedPass = null;
    this.aaPass = null;
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;
    if (this.renderPass) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
    }
  }

  setBloom(strength: number, radius: number, threshold: number): void {
    this.bloomStrength = strength;
    this.bloomRadius = radius;
    this.bloomThreshold = threshold;
    if (this.bloom) {
      this.bloom.strength = strength;
      this.bloom.radius = radius;
      this.bloom.threshold = threshold;
    }
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.config.pixelRatio) * this.config.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      if (this.bloom) {
        const s = this.config.bloomResolutionScale * 2;
        this.bloom.setSize(Math.max(64, w * pr * s), Math.max(64, h * pr * s));
      }
      if (this.speedPass) this.speedPass.uniforms.uAspect.value = w / Math.max(1, h);
    }
    const cam = this.camera as THREE.PerspectiveCamera | null;
    if (cam && cam.isPerspectiveCamera) {
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    }
  }

  get aspect(): number {
    return this.width / Math.max(1, this.height);
  }

  render(dt: number): void {
    if (!this.scene || !this.camera) return;
    this.time += dt;
    if (this.composer && this.speedPass) {
      const u = this.speedPass.uniforms;
      u.uStrength.value = this.fx.strength;
      u.uChroma.value = this.fx.chroma;
      u.uVignette.value = this.fx.vignette;
      u.uNitro.value = this.fx.nitro;
      u.uFade.value = this.fx.fade;
      u.uFlash.value = this.fx.flash;
      u.uTime.value = this.time % 100;
      (u.uCenter.value as THREE.Vector2).set(0.5, this.fx.centerY);
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  stats(): { calls: number; triangles: number; textures: number; geometries: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries };
  }
}
