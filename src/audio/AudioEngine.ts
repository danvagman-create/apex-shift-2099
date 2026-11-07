import { clamp } from '../core/utils';
import type { EngineAudioProfile } from '../vehicles/VehicleSpecs';

/**
 * Procedural audio: all sounds are synthesized in real time with the Web Audio API,
 * so no third-party samples (and no licensing concerns) are involved.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  uiBus!: GainNode;
  reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private volumes = { master: 0.8, music: 0.55, sfx: 0.9 };
  private lastHover = 0;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.uiBus.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // reverb (generated impulse response)
    const conv = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    conv.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(conv).connect(this.master);
    this.applyVolumes();
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.6, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.uiBus.gain.setTargetAtTime(this.volumes.sfx * 0.7, t, 0.05);
  }

  noiseSource(loop = true): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    s.loopStart = Math.random();
    return s;
  }

  /** Short tone with envelope. */
  tone(freq: number, dur: number, type: OscillatorType, gain: number, bus: AudioNode, opts: { slideTo?: number; attack?: number; delay?: number; reverb?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    if (opts.reverb) {
      const r = ctx.createGain();
      r.gain.value = opts.reverb;
      g.connect(r).connect(this.reverbSend);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Filtered noise burst. */
  burst(dur: number, filterType: BiquadFilterType, freq: number, q: number, gain: number, bus: AudioNode, opts: { sweepTo?: number; delay?: number; attack?: number; reverb?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    if (opts.reverb) {
      const r = ctx.createGain();
      r.gain.value = opts.reverb;
      g.connect(r).connect(this.reverbSend);
    }
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ UI
  uiHover(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHover < 0.04) return;
    this.lastHover = now;
    this.tone(2400, 0.05, 'sine', 0.05, this.uiBus);
  }
  uiSelect(): void {
    this.tone(880, 0.09, 'triangle', 0.14, this.uiBus);
    this.tone(1320, 0.14, 'triangle', 0.12, this.uiBus, { delay: 0.06, reverb: 0.3 });
  }
  uiBack(): void {
    this.tone(700, 0.12, 'triangle', 0.12, this.uiBus, { slideTo: 420 });
  }
  uiTransition(): void {
    this.burst(0.6, 'bandpass', 300, 1.2, 0.18, this.uiBus, { sweepTo: 3200, attack: 0.25, reverb: 0.4 });
    this.tone(110, 0.5, 'sine', 0.2, this.uiBus, { slideTo: 55 });
  }
  uiError(): void {
    this.tone(220, 0.16, 'square', 0.08, this.uiBus);
    this.tone(180, 0.2, 'square', 0.08, this.uiBus, { delay: 0.1 });
  }
  purchase(): void {
    [660, 990, 1320, 1760].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, this.uiBus, { delay: i * 0.06, reverb: 0.4 }));
  }

  // ------------------------------------------------------------------ race one-shots
  countdown(n: number): void {
    this.tone(n > 0 ? 880 : 1760, n > 0 ? 0.32 : 0.9, 'square', 0.16, this.sfxBus, { reverb: 0.3 });
    this.tone(n > 0 ? 440 : 880, n > 0 ? 0.32 : 0.9, 'sine', 0.18, this.sfxBus);
  }
  impact(intensity: number): void {
    const g = clamp(intensity, 0.05, 1);
    this.burst(0.25 + g * 0.3, 'lowpass', 1800 + g * 2500, 0.8, 0.5 * g, this.sfxBus, { sweepTo: 200 });
    this.tone(90, 0.3, 'sine', 0.5 * g, this.sfxBus, { slideTo: 40 });
    this.burst(0.5, 'bandpass', 3200, 18, 0.12 * g, this.sfxBus, { reverb: 0.2 });
  }
  scrape(intensity: number): void {
    this.burst(0.15, 'bandpass', 2600, 6, 0.12 * clamp(intensity, 0, 1), this.sfxBus);
  }
  landing(intensity: number): void {
    const g = clamp(intensity / 12, 0.1, 1);
    this.tone(70, 0.35, 'sine', 0.55 * g, this.sfxBus, { slideTo: 35 });
    this.burst(0.25, 'lowpass', 900, 1, 0.3 * g, this.sfxBus);
  }
  nitroBurst(): void {
    this.burst(0.9, 'bandpass', 400, 0.8, 0.35, this.sfxBus, { sweepTo: 4000, attack: 0.02, reverb: 0.25 });
    this.tone(55, 0.8, 'sawtooth', 0.12, this.sfxBus, { slideTo: 110 });
  }
  transform(toHover: boolean): void {
    // servo sweep + mechanical clunks + spool
    this.burst(0.7, 'bandpass', toHover ? 500 : 2000, 4, 0.18, this.sfxBus, { sweepTo: toHover ? 2600 : 400 });
    this.tone(toHover ? 140 : 420, 0.65, 'sawtooth', 0.06, this.sfxBus, { slideTo: toHover ? 420 : 140 });
    [0.08, 0.3, 0.55].forEach((d) => this.burst(0.07, 'lowpass', 600, 2, 0.35, this.sfxBus, { delay: d }));
    if (toHover) this.tone(220, 0.9, 'sine', 0.15, this.sfxBus, { slideTo: 880, delay: 0.35, reverb: 0.4 });
  }
  gearShift(): void {
    this.burst(0.06, 'bandpass', 1400, 3, 0.18, this.sfxBus);
  }
  lap(best: boolean): void {
    const notes = best ? [784, 988, 1175, 1568] : [784, 1175];
    notes.forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.14, this.sfxBus, { delay: i * 0.08, reverb: 0.5 }));
  }
  finish(win: boolean): void {
    const seq = win ? [523, 659, 784, 1047, 1319, 1568] : [523, 622, 784];
    seq.forEach((f, i) => this.tone(f, 0.5, 'square', 0.1, this.sfxBus, { delay: i * 0.11, reverb: 0.6 }));
  }
  respawn(): void {
    this.burst(0.8, 'bandpass', 3000, 2, 0.2, this.sfxBus, { sweepTo: 300, reverb: 0.5 });
  }
  whoosh(intensity: number): void {
    this.burst(0.45, 'bandpass', 600, 1.5, 0.25 * clamp(intensity, 0, 1), this.sfxBus, { sweepTo: 200, attack: 0.08 });
  }

  createEngineVoice(profile: EngineAudioProfile, main: boolean): EngineVoice | null {
    if (!this.ctx) return null;
    return new EngineVoice(this, profile, main);
  }

  createLoops(rain: boolean): RaceLoops | null {
    if (!this.ctx) return null;
    return new RaceLoops(this, rain);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }
  resume(): void {
    void this.ctx?.resume();
  }
}

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount * 60 + 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** Layered synthesized engine (combustion or electric) + hover hum. */
export class EngineVoice {
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private oscC: OscillatorNode;
  private whine: OscillatorNode;
  private whineGain: GainNode;
  private intake: AudioBufferSourceNode;
  private intakeFilter: BiquadFilterNode;
  private intakeGain: GainNode;
  private shaper: WaveShaperNode;
  private filter: BiquadFilterNode;
  private gain: GainNode;
  private panner: StereoPannerNode;
  private hoverA: OscillatorNode;
  private hoverB: OscillatorNode;
  private hoverGain: GainNode;
  private hoverNoise: AudioBufferSourceNode;
  private hoverNoiseFilter: BiquadFilterNode;
  private hoverNoiseGain: GainNode;
  private out: GainNode;
  private profile: EngineAudioProfile;
  private stopped = false;

  constructor(
    private readonly audio: AudioEngine,
    profile: EngineAudioProfile,
    private readonly main: boolean,
  ) {
    const ctx = audio.ctx!;
    this.profile = profile;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    this.out.connect(this.panner).connect(audio.sfxBus);
    this.gain = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.4;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = distortionCurve(profile.growl);
    this.shaper.oversample = main ? '2x' : 'none';
    this.oscA = ctx.createOscillator();
    this.oscB = ctx.createOscillator();
    this.oscC = ctx.createOscillator();
    const gA = ctx.createGain();
    const gB = ctx.createGain();
    const gC = ctx.createGain();
    gA.gain.value = 0.5;
    gB.gain.value = 0.45;
    gC.gain.value = 0.18;
    this.oscA.connect(gA).connect(this.shaper);
    this.oscB.connect(gB).connect(this.shaper);
    this.oscC.connect(gC).connect(this.shaper);
    this.shaper.connect(this.filter).connect(this.gain).connect(this.out);
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.out);
    this.intake = audio.noiseSource();
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 1.2;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intake.connect(this.intakeFilter).connect(this.intakeGain).connect(this.out);
    // hover hum
    this.hoverA = ctx.createOscillator();
    this.hoverB = ctx.createOscillator();
    this.hoverA.type = 'triangle';
    this.hoverB.type = 'sawtooth';
    this.hoverGain = ctx.createGain();
    this.hoverGain.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 900;
    this.hoverA.connect(this.hoverGain);
    this.hoverB.connect(hf).connect(this.hoverGain);
    this.hoverGain.connect(this.out);
    this.hoverNoise = audio.noiseSource();
    this.hoverNoiseFilter = ctx.createBiquadFilter();
    this.hoverNoiseFilter.type = 'bandpass';
    this.hoverNoiseFilter.Q.value = 3;
    this.hoverNoiseGain = ctx.createGain();
    this.hoverNoiseGain.gain.value = 0;
    this.hoverNoise.connect(this.hoverNoiseFilter).connect(this.hoverNoiseGain).connect(this.out);
    this.setProfile(profile);
    const t = ctx.currentTime;
    for (const o of [this.oscA, this.oscB, this.oscC, this.whine, this.hoverA, this.hoverB]) o.start(t);
    this.intake.start(t);
    this.hoverNoise.start(t);
  }

  setProfile(p: EngineAudioProfile): void {
    this.profile = p;
    this.oscA.type = p.wave;
    this.oscB.type = p.subWave;
    this.oscC.type = p.wave;
    this.oscC.detune.value = p.detune * 3;
    this.oscA.detune.value = -p.detune;
    this.shaper.curve = distortionCurve(p.growl);
  }

  /** rpm 0..1, speed m/s, hover 0..1, gain: distance attenuation, pan -1..1 */
  update(rpm: number, throttle: number, speed: number, hover: number, nitro: boolean, gain: number, pan: number): void {
    if (this.stopped) return;
    const ctx = this.audio.ctx!;
    const t = ctx.currentTime;
    const p = this.profile;
    const tc = 0.03;
    const f = p.base + p.range * rpm;
    this.oscA.frequency.setTargetAtTime(f, t, tc);
    this.oscB.frequency.setTargetAtTime(f * 0.5, t, tc);
    this.oscC.frequency.setTargetAtTime(f * 2, t, tc);
    this.whine.frequency.setTargetAtTime(f * p.whineRatio + speed * 6, t, tc);
    this.filter.frequency.setTargetAtTime(p.filter + throttle * 2600 + rpm * 1800 + (nitro ? 1500 : 0), t, tc);
    const road = 1 - hover * 0.75;
    const eng = (0.08 + 0.16 * throttle + 0.08 * rpm) * road;
    this.gain.gain.setTargetAtTime(eng, t, tc);
    this.whineGain.gain.setTargetAtTime(p.whine * (0.02 + 0.05 * clamp(speed / 100, 0, 1) + 0.03 * throttle) * (p.electric ? 1.6 : 1), t, tc);
    this.intakeFilter.frequency.setTargetAtTime(500 + rpm * 2500, t, tc);
    this.intakeGain.gain.setTargetAtTime((p.electric ? 0.01 : 0.05) * throttle * road, t, tc);
    const hf = 48 + speed * 0.7;
    this.hoverA.frequency.setTargetAtTime(hf, t, tc);
    this.hoverB.frequency.setTargetAtTime(hf * 1.503, t, tc);
    this.hoverGain.gain.setTargetAtTime(hover * (0.08 + 0.05 * throttle), t, tc);
    this.hoverNoiseFilter.frequency.setTargetAtTime(300 + speed * 18, t, tc);
    this.hoverNoiseGain.gain.setTargetAtTime(hover * (0.05 + 0.08 * throttle), t, tc);
    this.out.gain.setTargetAtTime(gain * (this.main ? 1 : 0.7), t, 0.06);
    this.panner.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.06);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const ctx = this.audio.ctx!;
    const t = ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    for (const o of [this.oscA, this.oscB, this.oscC, this.whine, this.hoverA, this.hoverB]) o.stop(t + 0.3);
    this.intake.stop(t + 0.3);
    this.hoverNoise.stop(t + 0.3);
    setTimeout(() => this.out.disconnect(), 400);
  }
}

/** Continuous race ambience: wind, tire slip/drift squeal, nitro roar, rain. */
export class RaceLoops {
  private windGain: GainNode;
  private windFilter: BiquadFilterNode;
  private tireGain: GainNode;
  private squeal: OscillatorNode;
  private squealGain: GainNode;
  private nitroGain: GainNode;
  private nitroSub: OscillatorNode;
  private rainGain: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private out: GainNode;

  constructor(
    private readonly audio: AudioEngine,
    rain: boolean,
  ) {
    const ctx = audio.ctx!;
    this.out = ctx.createGain();
    this.out.connect(audio.sfxBus);
    const wind = audio.noiseSource();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.out);
    const tire = audio.noiseSource();
    const tf = ctx.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 1700;
    tf.Q.value = 2.5;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    tire.connect(tf).connect(this.tireGain).connect(this.out);
    this.squeal = ctx.createOscillator();
    this.squeal.type = 'sawtooth';
    this.squeal.frequency.value = 820;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 1300;
    sf.Q.value = 6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 25;
    lfo.connect(lfoGain).connect(this.squeal.frequency);
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squeal.connect(sf).connect(this.squealGain).connect(this.out);
    const nz = audio.noiseSource();
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 1100;
    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.value = 0;
    nz.connect(nf).connect(this.nitroGain).connect(this.out);
    this.nitroSub = ctx.createOscillator();
    this.nitroSub.type = 'sine';
    this.nitroSub.frequency.value = 42;
    this.nitroSub.connect(this.nitroGain);
    this.sources.push(wind, tire, this.squeal, lfo, nz, this.nitroSub);
    if (rain) {
      const r = audio.noiseSource();
      const rf = ctx.createBiquadFilter();
      rf.type = 'highpass';
      rf.frequency.value = 2400;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0.045;
      r.connect(rf).connect(this.rainGain).connect(this.out);
      this.sources.push(r);
    }
    const t = ctx.currentTime;
    for (const s of this.sources) s.start(t);
  }

  update(speed: number, slip: number, drift: boolean, nitro: boolean, airborne: boolean, inTunnel: boolean): void {
    const t = this.audio.ctx!.currentTime;
    const v = clamp(Math.abs(speed) / 110, 0, 1.3);
    this.windGain.gain.setTargetAtTime(v * v * (inTunnel ? 0.4 : 0.26), t, 0.08);
    this.windFilter.frequency.setTargetAtTime(250 + v * 1400, t, 0.08);
    const s = airborne ? 0 : clamp(Math.abs(slip) * 2.2, 0, 1) * clamp(Math.abs(speed) / 20, 0, 1);
    this.tireGain.gain.setTargetAtTime(s * 0.12, t, 0.05);
    this.squealGain.gain.setTargetAtTime(drift && !airborne ? 0.035 + s * 0.04 : s > 0.5 ? s * 0.02 : 0, t, 0.05);
    this.nitroGain.gain.setTargetAtTime(nitro ? 0.22 : 0, t, nitro ? 0.03 : 0.15);
  }

  stop(): void {
    const t = this.audio.ctx!.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    for (const s of this.sources) s.stop(t + 0.3);
    setTimeout(() => this.out.disconnect(), 400);
  }
}
