import * as THREE from 'three';
import { clamp, damp, nextFrame, Rng } from '../core/utils';
import type { RenderContext } from '../core/RenderContext';
import type { Input } from '../core/Input';
import type { SaveManager } from '../core/SaveManager';
import type { AudioEngine, EngineVoice, RaceLoops } from '../audio/AudioEngine';
import type { MusicSystem } from '../audio/MusicSystem';
import { CAMERA_MODES } from '../core/Settings';
import { Track } from '../track/Track';
import { getTrackDef } from '../track/TrackDefinitions';
import { F_TUNNEL } from '../track/TrackLayout';
import { buildTrackMeshes, type TrackVisuals } from '../track/TrackMeshBuilder';
import type { Scenery } from '../track/scenery/common';
import { buildNeonTokyo } from '../track/scenery/NeonTokyoScenery';
import { buildRedlineCanyon } from '../track/scenery/RedlineCanyonScenery';
import { buildSkyline2099 } from '../track/scenery/Skyline2099Scenery';
import { createSky, SKY_PRESETS, type SkyTheme } from '../graphics/Sky';
import { buildEnvironment } from '../graphics/Environment';
import { ParticleSystem, Rain, SpeedLines } from '../graphics/Particles';
import { CameraRig } from '../camera/CameraRig';
import { AIDriver, TrackAIData } from '../race/AIDriver';
import { RaceSession, type Racer } from '../race/RaceSession';
import type { RaceConfig } from '../race/RaceConfig';
import { GhostPlayer, GhostRecorder } from '../race/Ghost';
import { CarModel } from '../vehicles/CarModel';
import { getVehicle } from '../vehicles/VehicleSpecs';
import { HUD, type HudFrame } from '../ui/HUD';

export interface RaceServices {
  ctx: RenderContext;
  input: Input;
  save: SaveManager;
  audio: AudioEngine;
  music: MusicSystem;
  uiRoot: HTMLElement;
}

export interface RaceResultRow {
  id: string;
  name: string;
  carId: string;
  isPlayer: boolean;
  position: number;
  time: number;
  bestLap: number;
  estimated: boolean;
}

export interface RaceResults {
  config: RaceConfig;
  rows: RaceResultRow[];
  playerPosition: number;
  playerTime: number;
  playerBestLap: number;
  lapTimes: number[];
  topSpeedKmh: number;
  distanceKm: number;
  newBestLap: boolean;
  ghostData?: { data: string; lapTime: number };
}

interface RaceVehicle {
  racer: Racer;
  model: CarModel;
  voice: EngineVoice | null;
  lastWall: number;
  lastSparkT: number;
  wasNitro: boolean;
  wasHover: boolean;
}

const THEME_LIGHT: Record<string, { hemiSky: string; hemiGround: string; hemi: number; sun: string; sunI: number; fog: string; fogD: number; exposure: number; bloom: [number, number, number]; env: number }> = {
  tokyo: { hemiSky: '#3a3070', hemiGround: '#07070c', hemi: 0.55, sun: '#9fb8ff', sunI: 0.7, fog: '#0c0a1e', fogD: 0.0016, exposure: 1.05, bloom: [1.0, 0.55, 0.78], env: 0.9 },
  canyon: { hemiSky: '#9fb4ff', hemiGround: '#7a3a20', hemi: 0.9, sun: '#ffc890', sunI: 3.2, fog: '#e6a274', fogD: 0.00042, exposure: 0.95, bloom: [0.45, 0.4, 0.95], env: 0.8 },
  skyline: { hemiSky: '#bcd6ff', hemiGround: '#f0d2b0', hemi: 1.0, sun: '#fff1d8', sunI: 3.0, fog: '#f2cfa6', fogD: 0.00022, exposure: 0.92, bloom: [0.45, 0.4, 0.95], env: 1.0 },
};

export class RaceScene {
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  session!: RaceSession;
  track!: Track;
  readonly vehicles: RaceVehicle[] = [];
  private trackVis!: TrackVisuals;
  private scenery!: Scenery;
  private sky!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private sun!: THREE.DirectionalLight;
  private headlight: THREE.SpotLight | null = null;
  private envTex: THREE.Texture | null = null;
  private sparks!: ParticleSystem;
  private smoke!: ParticleSystem;
  private glow!: ParticleSystem;
  private speedLines!: SpeedLines;
  private rain: Rain | null = null;
  private loops: RaceLoops | null = null;
  private aiVoices: EngineVoice[] = [];
  private hud!: HUD;
  private cube: { cam: THREE.CubeCamera; rt: THREE.WebGLCubeRenderTarget } | null = null;
  private frame = 0;
  private time = 0;
  phase: 'intro' | 'race' | 'finished' | 'done' = 'intro';
  private finishTimer = 0;
  private respawnFade = 0;
  paused = false;
  private ghostPlayer: GhostPlayer | null = null;
  private ghostModel: CarModel | null = null;
  private recorder = new GhostRecorder();
  private bestGhost: { data: string; lapTime: number } | null = null;
  private newBestLap = false;
  private theme: SkyTheme;
  private rng = new Rng(5);
  onFinish: ((r: RaceResults) => void) | null = null;
  private playerAI: AIDriver | null = null;
  private lapStartProgress = 0;
  private hoverOnlyWarned = -1;
  private shortcutAnnounced = false;
  private driftScore = 0;
  private driftTimer = 0;

  constructor(
    private readonly svc: RaceServices,
    readonly config: RaceConfig,
  ) {
    const def = getTrackDef(config.trackId);
    this.theme = def.theme;
    this.rig = new CameraRig(svc.ctx.aspect, svc.ctx.config.drawDistance + 2000);
    this.rig.mode = svc.save.data.settings.camera;
  }

  get playerRacer(): Racer {
    return this.session.player!;
  }

  /** Build everything; yields between heavy steps so a loading screen can animate. */
  async build(progress: (p: number, label: string) => void): Promise<void> {
    const svc = this.svc;
    const cfg = svc.ctx.config;
    const def = getTrackDef(this.config.trackId);
    progress(0.05, 'GENERATING CIRCUIT');
    await nextFrame();
    this.track = new Track(def);
    progress(0.15, 'COMPUTING RACING LINES');
    await nextFrame();
    const ai = new TrackAIData(this.track);
    this.session = new RaceSession(this.config, this.track, ai, { withPlayer: true, countdown: 5.2 });
    progress(0.3, 'BUILDING ROAD SURFACES');
    await nextFrame();
    this.trackVis = buildTrackMeshes(this.track, this.theme, cfg);
    this.scene.add(this.trackVis.group);
    progress(0.45, 'RAISING THE SKYLINE');
    await nextFrame();
    this.scenery = this.theme === 'tokyo' ? buildNeonTokyo(this.track, cfg) : this.theme === 'canyon' ? buildRedlineCanyon(this.track, cfg) : buildSkyline2099(this.track, cfg);
    this.scene.add(this.scenery.group);
    progress(0.65, 'LIGHTING & REFLECTIONS');
    await nextFrame();
    this.setupLighting();
    progress(0.75, 'ASSEMBLING VEHICLES');
    await nextFrame();
    this.spawnVehicles();
    progress(0.88, 'CALIBRATING SENSORS');
    await nextFrame();
    this.setupEffects();
    this.hud = new HUD(svc.uiRoot, {
      track: this.track,
      units: svc.save.data.settings.units,
      showFps: svc.save.data.settings.showFps,
      minimap: svc.save.data.settings.minimap,
      mode: this.config.mode,
      laps: this.config.laps,
    });
    // precompile shaders to avoid hitches on first frame
    this.rig.camera.aspect = svc.ctx.aspect;
    this.rig.intro(0, this.playerRacer.physics, 0, 3);
    svc.ctx.renderer.compile(this.scene, this.rig.camera);
    progress(1, 'READY');
    await nextFrame();
  }

  private setupLighting(): void {
    const svc = this.svc;
    const cfg = svc.ctx.config;
    const L = THEME_LIGHT[this.theme];
    const s = this.scene;
    this.sky = createSky(this.theme, cfg.drawDistance + 1200);
    s.add(this.sky);
    s.fog = new THREE.FogExp2(L.fog, L.fogD * (3200 / cfg.drawDistance) ** 0.5);
    s.background = new THREE.Color(L.fog);
    this.envTex = buildEnvironment(svc.ctx.renderer, this.theme);
    s.environment = this.envTex;
    s.environmentIntensity = L.env;
    s.add(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemi));
    this.sun = new THREE.DirectionalLight(L.sun, L.sunI);
    const sd = SKY_PRESETS[this.theme].sunDir;
    this.sun.position.set(sd[0], Math.max(0.25, sd[1]), sd[2]).normalize().multiplyScalar(200);
    this.sun.castShadow = cfg.shadows;
    if (cfg.shadows) {
      this.sun.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
      const sc = this.sun.shadow.camera;
      sc.left = -70;
      sc.right = 70;
      sc.top = 70;
      sc.bottom = -70;
      sc.near = 10;
      sc.far = 500;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
    }
    s.add(this.sun, this.sun.target);
    svc.ctx.renderer.toneMappingExposure = L.exposure;
    svc.ctx.setBloom(L.bloom[0], L.bloom[1], L.bloom[2]);
  }

  private spawnVehicles(): void {
    const svc = this.svc;
    const cfg = svc.ctx.config;
    for (const r of this.session.racers) {
      const spec = getVehicle(r.info.carId);
      let look;
      if (r.info.isPlayer) {
        const c = svc.save.customization(r.info.carId);
        look = { paint: c.paint, finish: c.finish, accent: c.accent, light: c.light, rim: c.rim, hover: spec.colors.hover };
      } else {
        look = { paint: r.info.paint, finish: 'metallic' as const, accent: spec.colors.accent, light: spec.colors.light, rim: spec.colors.rim, hover: spec.colors.hover };
      }
      const model = new CarModel(spec, look, { lod: r.info.isPlayer ? 'high' : 'auto', interior: r.info.isPlayer, shadows: cfg.shadows });
      this.scene.add(model);
      const voice = r.info.isPlayer ? svc.audio.createEngineVoice(spec.audio, true) : null;
      this.vehicles.push({ racer: r, model, voice, lastWall: 0, lastSparkT: 0, wasNitro: false, wasHover: false });
    }
    // two pooled AI voices for nearest opponents
    for (let i = 0; i < 2; i++) {
      const v = svc.audio.createEngineVoice(getVehicle('vortex').audio, false);
      if (v) this.aiVoices.push(v);
    }
    // night headlights
    if (this.theme === 'tokyo' && cfg.headlightLights) {
      const hl = new THREE.SpotLight('#eaf4ff', 900, 140, 0.42, 0.55, 1.4);
      hl.castShadow = false;
      this.scene.add(hl, hl.target);
      this.headlight = hl;
    }
    // time-trial ghost
    if (this.config.mode === 'timetrial') {
      const rec = svc.save.record(this.config.trackId);
      if (rec.ghost) {
        try {
          this.ghostPlayer = new GhostPlayer(rec.ghost);
          const gspec = getVehicle(rec.ghostCar ?? this.config.playerCar);
          this.ghostModel = new CarModel(gspec, { paint: '#4de1ff', finish: 'gloss', accent: '#4de1ff', light: '#ffffff', rim: '#4de1ff', hover: '#4de1ff' }, { lod: 'low', interior: false, shadows: false });
          this.ghostModel.setGhost();
          this.scene.add(this.ghostModel);
        } catch {
          this.ghostPlayer = null;
        }
      }
    }
    if (cfg.dynamicReflections) {
      const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cam = new THREE.CubeCamera(1, 900, rt);
      this.scene.add(cam);
      this.cube = { cam, rt };
      const pm = this.vehicles.find((v) => v.racer.info.isPlayer)!.model;
      pm.paintMat.envMap = rt.texture;
      pm.paintMat.needsUpdate = true;
    }
  }

  private setupEffects(): void {
    const cfg = this.svc.ctx.config;
    const p = cfg.particles;
    this.sparks = new ParticleSystem({ max: Math.round(900 * p), texture: 'glow', additive: true, gravity: 9, drag: 1.2 });
    this.smoke = new ParticleSystem({ max: Math.round(700 * p), texture: 'smoke', additive: false, gravity: -0.4, drag: 1.6 });
    this.glow = new ParticleSystem({ max: Math.round(800 * p), texture: 'glow', additive: true, gravity: 0, drag: 2.5 });
    this.scene.add(this.sparks.points, this.smoke.points, this.glow.points);
    this.speedLines = new SpeedLines(Math.round(260 * Math.max(0.5, p)));
    this.rig.camera.add(this.speedLines.mesh);
    this.scene.add(this.rig.camera);
    if (this.theme === 'tokyo') {
      this.rain = new Rain(Math.round(4000 * p));
      this.scene.add(this.rain.mesh);
    }
    this.loops = this.svc.audio.createLoops(this.theme === 'tokyo');
  }

  /** Called once loading UI is gone. */
  start(): void {
    this.svc.music.play('race');
    this.svc.music.intensity = 0.6;
    this.hud.show();
    this.svc.ctx.setScene(this.scene, this.rig.camera);
    this.svc.ctx.resize();
  }

  cycleCamera(): void {
    const i = CAMERA_MODES.indexOf(this.rig.mode);
    this.rig.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.svc.save.data.settings.camera = this.rig.mode;
    this.svc.save.save();
    this.hud.toast(`CAMERA: ${this.rig.mode.toUpperCase()}`, 'info', 1);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) this.svc.audio.ctx?.suspend();
    else this.svc.audio.ctx?.resume();
  }

  update(dtRaw: number): void {
    const svc = this.svc;
    const dt = Math.min(dtRaw, 1 / 20);
    if (this.paused) return;
    this.time += dt;
    this.frame++;
    const player = this.playerRacer;
    const pp = player.physics;
    const settings = svc.save.data.settings;

    // ---- input
    const inp = svc.input.update(dt, Math.abs(pp.speed));
    if (svc.input.consume('camera')) this.cycleCamera();
    let driveInput = inp;
    if (this.phase === 'finished' || this.phase === 'done') {
      if (!this.playerAI) this.playerAI = new AIDriver(pp, this.session.ai, 'technical', 'normal', 99);
      driveInput = this.playerAI.update(dt, { cars: this.session.physicsList, progress: this.session.racers.map((r) => r.progress), myIndex: player.index, playerIndex: -1, raceTime: this.session.time });
    }
    // ---- simulation
    const prevState = this.session.state;
    this.session.update(dt, driveInput);
    if (prevState === 'countdown' && this.session.state === 'racing') this.phase = 'race';
    this.processEvents();

    // ---- visuals per vehicle
    for (const v of this.vehicles) this.updateVehicle(v, dt);
    this.updateGhost(dt);

    // ---- camera
    const inTunnel = (pp.proj.flags & F_TUNNEL) !== 0;
    if (this.session.state === 'countdown' && this.session.countdown > 3.4) {
      this.rig.intro(dt, pp, 5.2 - this.session.countdown, 1.8);
    } else if (this.phase === 'finished' || this.phase === 'done') {
      this.finishTimer += dt;
      this.rig.finish(dt, pp, this.finishTimer);
    } else {
      this.rig.update(dt, pp, this.vehicle(player).model, { dynamicFov: settings.dynamicFov, shake: settings.cameraShake }, svc.input.lookBack, inTunnel);
    }

    // ---- post fx + effects
    const fx = svc.ctx.fx;
    const sn = this.rig.speedNorm;
    const mb = settings.motionBlur;
    const racing = this.phase === 'race';
    fx.strength = damp(fx.strength, racing ? Math.max(0, sn - 0.35) * 1.3 * mb + (pp.nitroActive ? 0.35 * mb : 0) : 0, 4, dt);
    fx.chroma = damp(fx.chroma, racing ? Math.max(0, sn - 0.5) * 1.6 + (pp.nitroActive ? 0.8 : 0) : 0, 4, dt);
    fx.vignette = damp(fx.vignette, 0.3 + sn * 0.35 + (pp.nitroActive ? 0.25 : 0), 3, dt);
    fx.nitro = damp(fx.nitro, pp.nitroActive ? 1 : 0, 6, dt);
    fx.flash = Math.max(0, fx.flash - dt * 3);
    if (pp.fallen) this.respawnFade = Math.min(1, this.respawnFade + dt * 2.5);
    else this.respawnFade = Math.max(0, this.respawnFade - dt * 2);
    fx.fade = this.respawnFade;
    this.speedLines.update(dt, Math.max(0, pp.speed), pp.nitroActive);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.glow.update(dt);
    const h = svc.ctx.renderer.domElement.clientHeight || 720;
    for (const ps of [this.sparks, this.smoke, this.glow]) ps.setScale(h, this.rig.camera.fov);
    this.rain?.update(dt, this.rig.camera.position, pp.vel);

    // sky + shadows follow the player
    this.sky.position.copy(this.rig.camera.position);
    this.sky.material.uniforms.uTime.value = this.time;
    const sd = SKY_PRESETS[this.theme].sunDir;
    this.sun.target.position.copy(pp.pos);
    this.sun.position.set(pp.pos.x + sd[0] * 200, pp.pos.y + Math.max(0.25, sd[1]) * 200 + 60, pp.pos.z + sd[2] * 200);
    for (const m of this.trackVis.animated) m.uniforms.uTime.value = this.time;
    this.scenery.update(dt, this.time, this.rig.camera);
    if (this.headlight) {
      const pm = this.vehicle(player).model;
      this.headlight.position.copy(pm.localToWorld(new THREE.Vector3(0, 0.7, 2.2)));
      this.headlight.target.position.copy(pm.localToWorld(new THREE.Vector3(0, 0, 30)));
    }
    if (this.cube && this.frame % 3 === 0) {
      const pm = this.vehicle(player).model;
      pm.visible = false;
      this.cube.cam.position.copy(pp.pos).y += 1;
      this.cube.cam.update(svc.ctx.renderer, this.scene);
      this.cube.rt.texture.needsPMREMUpdate = true;
      pm.visible = true;
    }

    // ---- audio
    this.updateAudio(inTunnel);

    // ---- HUD
    this.updateHud(dt);

    // ---- finish flow
    if (this.phase === 'finished' && (this.session.state === 'finished' || this.finishTimer > 7)) {
      if (this.finishTimer > 4.5) {
        this.phase = 'done';
        this.emitResults();
      }
    }
  }

  private vehicle(r: Racer): RaceVehicle {
    return this.vehicles[r.index];
  }

  private processEvents(): void {
    const svc = this.svc;
    const player = this.playerRacer;
    for (const e of this.session.events) {
      switch (e.type) {
        case 'countdown':
          if (e.value <= 3) {
            this.hud.countdown(String(e.value));
            svc.audio.countdown(e.value);
          }
          break;
        case 'go':
          this.hud.countdown('GO!');
          svc.audio.countdown(0);
          this.phase = 'race';
          this.lapStartProgress = 0;
          this.recorder.reset();
          break;
        case 'lap':
          if (e.racer === player) {
            const isRecord = svc.save.submitLap(this.config.trackId, e.time, this.config.playerCar);
            if (isRecord) this.newBestLap = true;
            const ghostWorthy = this.config.mode === 'timetrial' && (isRecord || !svc.save.record(this.config.trackId).ghost);
            if (ghostWorthy && this.recorder.length > 20) {
              this.bestGhost = { data: this.recorder.serialize(), lapTime: e.time };
              const rec = svc.save.record(this.config.trackId);
              rec.ghost = this.bestGhost.data;
              rec.ghostCar = this.config.playerCar;
              rec.ghostLapTime = e.time;
              svc.save.save();
            } else if (isRecord) svc.save.save();
            this.recorder.reset();
            this.lapStartProgress = player.progress;
            svc.audio.lap(isRecord || e.best);
            this.hud.toast(`LAP ${e.lap}  ${fmt(e.time)}`, isRecord ? 'record' : e.best ? 'good' : 'info', 2.2);
            if (isRecord) this.hud.banner('NEW TRACK RECORD', 'record');
          }
          break;
        case 'finalLap':
          if (e.racer === player) {
            this.hud.banner('FINAL LAP', 'warn');
            svc.music.intensity = 1;
          }
          break;
        case 'finish':
          if (e.racer === player) {
            this.phase = 'finished';
            this.finishTimer = 0;
            const win = e.position === 1;
            svc.audio.finish(win && this.config.mode !== 'timetrial');
            this.hud.banner(this.config.mode === 'timetrial' ? 'FINISH' : win ? 'VICTORY' : `FINISHED ${ordinalStr(e.position)}`, win ? 'record' : 'good');
            svc.ctx.fx.flash = 0.25;
          }
          break;
        case 'respawn':
          if (e.racer === player) {
            svc.audio.respawn();
            this.hud.toast('RESPAWN', 'warn', 1.2);
            this.rig.reset(player.physics);
          }
          break;
        case 'checkpoint':
          if (e.racer === player && this.ghostPlayer && this.config.mode === 'timetrial') {
            const lapProg = player.progress - this.lapStartProgress;
            const gt = this.ghostPlayer.timeAtProgress(lapProg);
            if (gt !== null) {
              const d = this.session.time - player.lapStart - gt;
              this.hud.toast(`${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}`, d <= 0 ? 'good' : 'warn', 1.6);
            }
          }
          break;
      }
    }
    this.session.events.length = 0;
  }

  private updateVehicle(v: RaceVehicle, dt: number): void {
    const p = v.racer.physics;
    const m = v.model;
    const svc = this.svc;
    const isPlayer = v.racer.info.isPlayer;
    m.position.copy(p.pos);
    m.quaternion.copy(p.quaternion);
    m.update(dt, {
      transform: p.transform,
      speed: p.speed,
      steerAngle: p.steerAngle,
      bodyPitch: p.bodyPitch,
      bodyRoll: p.bodyRoll,
      bounce: p.bounce,
      nitro: p.nitroActive,
      throttle: p.throttle,
      brake: p.brake,
      ride: p.rideOffset,
      drifting: p.drifting,
    });
    m.visible = !(p.fallen && this.respawnFade > 0.95 && isPlayer) && !(p.ghost > 0 && Math.floor(this.time * 12) % 2 === 0);
    const ev = p.events;
    const dist = p.pos.distanceTo(this.rig.camera.position);
    const near = dist < 140;
    // sparks from walls / cars
    if ((ev.wallHit > 1 || ev.sparks > 0) && near) {
      const side = p.proj.lateral > 0 ? 1 : -1;
      const at = p.pos.clone().addScaledVector(p.right, side * 1.0).addScaledVector(p.up, 0.4);
      const n = Math.round(clamp(ev.wallHit * 1.5 + ev.sparks * 6, 3, 40) * svc.ctx.config.particles);
      for (let i = 0; i < n; i++) {
        const vel = p.vel.clone().multiplyScalar(0.55).add(new THREE.Vector3(this.rng.range(-4, 4), this.rng.range(1, 6), this.rng.range(-4, 4)));
        this.sparks.emit(at, vel, this.rng.range(0.25, 0.7), this.rng.range(0.08, 0.2), new THREE.Color(1.0, 0.65, 0.25).multiplyScalar(3), 1);
      }
      if (isPlayer && ev.wallHit > 2 && this.time - v.lastWall > 0.15) {
        svc.audio.impact(ev.wallHit / 25);
        this.rig.addTrauma(clamp(ev.wallHit / 30, 0.15, 0.7));
        v.lastWall = this.time;
      } else if (isPlayer && ev.sparks > 0 && this.time - v.lastSparkT > 0.12) {
        svc.audio.scrape(ev.sparks);
        v.lastSparkT = this.time;
      }
    }
    if (ev.carHit > 1.5 && near) {
      const at = p.pos.clone().addScaledVector(p.up, 0.6);
      for (let i = 0; i < 14; i++) this.sparks.emit(at, new THREE.Vector3(this.rng.range(-6, 6), this.rng.range(1, 5), this.rng.range(-6, 6)).add(p.vel.clone().multiplyScalar(0.6)), 0.4, 0.15, new THREE.Color(1, 0.8, 0.4).multiplyScalar(3), 1);
      if (isPlayer || dist < 25) {
        svc.audio.impact(ev.carHit / 20);
        if (isPlayer) this.rig.addTrauma(clamp(ev.carHit / 25, 0.15, 0.6));
      }
    }
    if (ev.landing > 3 && near) {
      if (isPlayer) {
        svc.audio.landing(ev.landing);
        this.rig.addTrauma(clamp(ev.landing / 18, 0.1, 0.6));
      }
      for (let i = 0; i < 18; i++) {
        const at = p.pos.clone().addScaledVector(p.right, this.rng.range(-1.2, 1.2));
        this.smoke.emit(at, new THREE.Vector3(this.rng.range(-3, 3), this.rng.range(0.5, 2), this.rng.range(-3, 3)), 1.2, 1.2, this.theme === 'canyon' ? new THREE.Color('#c28a5a') : new THREE.Color('#9aa0aa'), 0.35, 2.5);
      }
    }
    // drift / slip smoke
    const slipping = p.grounded && p.hoverBlend < 0.3 && (p.drifting || Math.abs(p.slip) > 0.12) && Math.abs(p.speed) > 12;
    if (slipping && near && this.frame % 2 === 0) {
      for (const side of [-1, 1]) {
        const at = p.pos.clone().addScaledVector(p.forward, -1.4).addScaledVector(p.right, side * 0.85).addScaledVector(p.up, 0.25);
        const col = this.theme === 'canyon' ? new THREE.Color('#c99868') : this.theme === 'tokyo' ? new THREE.Color('#8f95a3') : new THREE.Color('#d8dce4');
        this.smoke.emit(at, p.vel.clone().multiplyScalar(0.25).add(new THREE.Vector3(0, 0.6, 0)), 1.4, 0.9, col, 0.32, 3.2);
      }
    }
    // nitro / hover glow particles
    if (p.nitroActive && near) {
      for (const a of m.nozzleAnchors) {
        const at = m.localToWorld(a.clone());
        this.glow.emit(at, p.vel.clone().multiplyScalar(0.6).addScaledVector(p.forward, -8), 0.18, 0.35, new THREE.Color('#7fd8ff').multiplyScalar(2), 0.8);
      }
    }
    if (p.transform > 0.7 && near && this.frame % 3 === 0) {
      const at = p.pos.clone().addScaledVector(p.right, this.rng.range(-0.9, 0.9)).addScaledVector(p.forward, this.rng.range(-1.6, 1.6)).addScaledVector(p.up, -p.rideOffset + 0.1);
      this.glow.emit(at, p.vel.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.3, 0)), 0.4, 0.25, new THREE.Color(getVehicle(v.racer.info.carId).colors.hover).multiplyScalar(1.5), 0.6);
    }
    // player-only audio events
    if (isPlayer) {
      if (ev.transformStart) {
        svc.audio.transform(p.targetHover);
        this.hud.toast(p.targetHover ? 'HOVER MODE' : 'ROAD MODE', 'mode', 1);
      }
      if (ev.nitroStart) {
        svc.audio.nitroBurst();
        this.rig.addTrauma(0.25);
        svc.ctx.fx.flash = 0.06;
      }
      if (ev.gearShift > 0 && p.throttle > 0.5) svc.audio.gearShift();
      // drift scoring
      if (p.drifting) {
        this.driftTimer += dt;
        this.driftScore += dt * Math.abs(p.speed) * Math.abs(Math.sin(p.slip)) * 10;
      } else if (this.driftTimer > 0) {
        if (this.driftScore > 150) this.hud.toast(`DRIFT +${Math.round(this.driftScore)}`, 'good', 1.4);
        this.driftScore = 0;
        this.driftTimer = 0;
      }
    }
    v.wasNitro = p.nitroActive;
    v.wasHover = p.targetHover;
  }

  private updateGhost(dt: number): void {
    const player = this.playerRacer;
    const pp = player.physics;
    if (this.config.mode === 'timetrial' && this.phase === 'race') {
      this.recorder.record(dt, pp.pos.clone().addScaledVector(pp.up, 0), pp.quaternion, pp.transform, player.progress - this.lapStartProgress);
    }
    if (this.ghostPlayer && this.ghostModel) {
      const lapT = this.session.time - player.lapStart;
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = this.phase === 'race' ? this.ghostPlayer.sample(lapT, pos, q) : null;
      this.ghostModel.visible = !!s;
      if (s) {
        this.ghostModel.position.copy(pos);
        this.ghostModel.quaternion.copy(q);
        this.ghostModel.update(dt, { transform: s.transform, speed: 60, steerAngle: 0, bodyPitch: 0, bodyRoll: 0, bounce: 0, nitro: false, throttle: 1, brake: 0, ride: s.transform * 0.7 });
      }
    }
  }

  private updateAudio(inTunnel: boolean): void {
    const pp = this.playerRacer.physics;
    const pv = this.vehicle(this.playerRacer).voice;
    const camPos = this.rig.camera.position;
    pv?.update(pp.rpm, pp.throttle, Math.abs(pp.speed), pp.hoverBlend, pp.nitroActive, 1, 0);
    this.loops?.update(pp.speed, pp.slip, pp.drifting, pp.nitroActive, !pp.grounded, inTunnel);
    // nearest AI cars get the pooled voices
    const others = this.vehicles.filter((v) => !v.racer.info.isPlayer).map((v) => ({ v, d: v.racer.physics.pos.distanceTo(camPos) })).sort((a, b) => a.d - b.d);
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.rig.camera.quaternion);
    this.aiVoices.forEach((voice, i) => {
      const o = others[i];
      if (!o) {
        voice.update(0, 0, 0, 0, false, 0, 0);
        return;
      }
      const p = o.v.racer.physics;
      const gain = clamp(1 - o.d / 90, 0, 1) ** 2;
      const pan = clamp(new THREE.Vector3().subVectors(p.pos, camPos).normalize().dot(camRight), -1, 1);
      const spec = getVehicle(o.v.racer.info.carId);
      if ((voice as unknown as { _car?: string })._car !== spec.id) {
        voice.setProfile(spec.audio);
        (voice as unknown as { _car?: string })._car = spec.id;
      }
      voice.update(p.rpm, p.throttle, Math.abs(p.speed), p.hoverBlend, p.nitroActive, gain, pan);
    });
  }

  private updateHud(dt: number): void {
    const s = this.session;
    const player = this.playerRacer;
    const pp = player.physics;
    const standings = s.standings;
    const total = s.racers.length;
    const idx = standings.indexOf(player);
    const ahead = idx > 0 ? standings[idx - 1] : null;
    const behind = idx < standings.length - 1 ? standings[idx + 1] : null;
    // opponent indicators (cars close behind)
    const indicators: HudFrame['behind'] = [];
    const camQ = this.rig.camera.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQ);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQ);
    const tags: HudFrame['tags'] = [];
    const proj = new THREE.Vector3();
    const camera = this.rig.camera;
    for (const r of s.racers) {
      if (r === player) continue;
      const d = r.physics.pos.distanceTo(pp.pos);
      const rel = new THREE.Vector3().subVectors(r.physics.pos, pp.pos);
      const gap = r.progress - player.progress;
      if (gap < 0 && gap > -40 && rel.dot(fwd) < 0) indicators.push({ side: clamp(rel.dot(right) / Math.max(4, d), -1, 1), dist: -gap, name: r.info.short });
      if (d < 120 && rel.dot(fwd) > 0) {
        proj.copy(r.physics.pos).addScaledVector(r.physics.up, 1.9).project(camera);
        if (proj.z < 1) tags.push({ x: (proj.x * 0.5 + 0.5) * 100, y: (-proj.y * 0.5 + 0.5) * 100, label: r.info.short, pos: r.position, dist: d });
      }
    }
    const nextBranch = this.track.branches.find((b) => {
      let dd = b.entryS - pp.proj.s;
      if (dd < 0) dd += this.track.length;
      return pp.pathIndex === 0 && dd < 260 && dd > 0;
    });
    if (nextBranch && this.hoverOnlyWarned !== nextBranch.index) {
      this.hoverOnlyWarned = nextBranch.index;
      this.hud.toast(`HOVER SHORTCUT ${nextBranch.side > 0 ? 'RIGHT ▶' : '◀ LEFT'}`, 'mode', 2.2);
    }
    if (pp.pathIndex !== 0 && !this.shortcutAnnounced) {
      this.shortcutAnnounced = true;
      this.hud.toast('SHORTCUT!', 'good', 1.2);
    } else if (pp.pathIndex === 0) this.shortcutAnnounced = false;
    let delta: number | null = null;
    if (this.ghostPlayer && this.phase === 'race') {
      const gt = this.ghostPlayer.timeAtProgress(player.progress - this.lapStartProgress);
      if (gt !== null) delta = s.time - player.lapStart - gt;
    }
    this.hud.update(dt, {
      speedKmh: pp.speedKmh,
      rpm: pp.rpm,
      gear: pp.gear,
      nitro: pp.nitro / pp.spec.nitroCapacity,
      nitroActive: pp.nitroActive,
      transform: pp.transform,
      targetHover: pp.targetHover,
      position: player.position,
      total,
      lap: Math.min(this.config.laps, player.currentLap),
      laps: this.config.laps,
      raceTime: s.state === 'countdown' ? 0 : player.finished ? player.finishTime : s.time,
      lapTime: s.state === 'countdown' ? 0 : player.finished ? player.lapTimes[player.lapTimes.length - 1] ?? 0 : s.time - player.lapStart,
      bestLap: Math.min(player.bestLap, this.svc.save.record(this.config.trackId).bestLap ?? Infinity),
      lastLap: player.lapTimes[player.lapTimes.length - 1] ?? null,
      gapAhead: ahead ? s.gapSeconds(player, ahead) : null,
      gapBehind: behind ? -s.gapSeconds(player, behind) : null,
      aheadName: ahead?.info.short ?? null,
      behindName: behind?.info.short ?? null,
      standings: standings.map((r) => ({ short: r.info.short, isPlayer: r.info.isPlayer, finished: r.finished, gap: r === standings[0] ? null : s.gapSeconds(r, standings[0]) })),
      cars: s.racers.map((r) => ({ x: r.physics.pos.x, z: r.physics.pos.z, isPlayer: r.info.isPlayer, color: r.info.isPlayer ? '#ffffff' : r.info.paint })),
      heading: pp.yaw,
      wrongWay: player.wrongWay,
      drift: this.driftScore,
      inHoverLane: pp.inHoverLane,
      onShortcut: pp.pathIndex !== 0,
      draft: pp.draft,
      behind: indicators,
      tags,
      delta,
      airborne: !pp.grounded && pp.airTime > 0.25,
    });
  }

  private emitResults(): void {
    const s = this.session;
    const player = this.playerRacer;
    const rows: RaceResultRow[] = s.standings.map((r) => ({
      id: r.info.id,
      name: r.info.name,
      carId: r.info.carId,
      isPlayer: r.info.isPlayer,
      position: r.position,
      time: r.finishTime,
      bestLap: r.bestLap,
      estimated: r.lapTimes.length < this.config.laps,
    }));
    const res: RaceResults = {
      config: this.config,
      rows,
      playerPosition: player.position,
      playerTime: player.finishTime,
      playerBestLap: player.bestLap,
      lapTimes: player.lapTimes,
      topSpeedKmh: player.physics.topSpeed * 3.6,
      distanceKm: player.physics.distance / 1000,
      newBestLap: this.newBestLap,
      ghostData: this.bestGhost ?? undefined,
    };
    this.onFinish?.(res);
  }

  /** Quit mid-race: produce no results. */
  dispose(): void {
    this.hud?.dispose();
    for (const v of this.vehicles) {
      v.voice?.stop();
      v.model.dispose();
    }
    for (const v of this.aiVoices) v.stop();
    this.loops?.stop();
    this.ghostModel?.dispose();
    this.trackVis?.dispose();
    this.scenery?.dispose();
    this.sparks?.dispose();
    this.smoke?.dispose();
    this.glow?.dispose();
    this.speedLines?.dispose();
    this.rain?.dispose();
    this.envTex?.dispose();
    this.cube?.rt.dispose();
    this.sky?.geometry.dispose();
    this.sky?.material.dispose();
    const fx = this.svc.ctx.fx;
    fx.strength = fx.chroma = fx.nitro = fx.fade = fx.flash = 0;
  }
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function ordinalStr(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
