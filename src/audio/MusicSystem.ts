import type { AudioEngine } from './AudioEngine';

type Theme = 'menu' | 'race' | 'results' | 'none';

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface Song {
  bpm: number;
  chords: number[][]; // midi notes per bar
  bass: number[]; // root per bar
  drums: boolean;
  hats: boolean;
  lead: boolean;
  arp: boolean;
  swing: number;
}

const SONGS: Record<Exclude<Theme, 'none'>, Song> = {
  menu: {
    bpm: 92,
    chords: [
      [57, 60, 64, 67],
      [53, 57, 60, 64],
      [48, 52, 55, 59],
      [55, 59, 62, 66],
    ],
    bass: [33, 29, 36, 31],
    drums: false,
    hats: true,
    lead: false,
    arp: true,
    swing: 0,
  },
  race: {
    bpm: 128,
    chords: [
      [57, 60, 64],
      [53, 57, 60],
      [50, 53, 57],
      [52, 56, 59],
    ],
    bass: [33, 29, 26, 28],
    drums: true,
    hats: true,
    lead: true,
    arp: true,
    swing: 0,
  },
  results: {
    bpm: 100,
    chords: [
      [60, 64, 67, 71],
      [57, 60, 64, 67],
      [53, 57, 60, 64],
      [55, 59, 62, 65],
    ],
    bass: [36, 33, 29, 31],
    drums: true,
    hats: true,
    lead: false,
    arp: true,
    swing: 0,
  },
};

/** Lookahead step sequencer generating original synthwave music on the fly. */
export class MusicSystem {
  private theme: Theme = 'none';
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bus: GainNode | null = null;
  intensity = 0.6;

  constructor(private readonly audio: AudioEngine) {}

  play(theme: Theme): void {
    if (theme === this.theme) return;
    this.stop();
    this.theme = theme;
    const ctx = this.audio.ctx;
    if (!ctx || theme === 'none') return;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    this.bus.connect(this.audio.musicBus);
    this.nextTime = ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const ctx = this.audio.ctx;
    if (this.bus && ctx) {
      const b = this.bus;
      b.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => b.disconnect(), 1500);
    }
    this.bus = null;
    this.theme = 'none';
  }

  private schedule(): void {
    const ctx = this.audio.ctx;
    if (!ctx || !this.bus || this.theme === 'none') return;
    const song = SONGS[this.theme];
    const sixteenth = 60 / song.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.14) {
      this.playStep(song, this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % (16 * song.chords.length * 2);
    }
  }

  private playStep(song: Song, step: number, t: number, len: number): void {
    const bar = Math.floor(step / 16) % song.chords.length;
    const s = step % 16;
    const chord = song.chords[bar];
    const intense = this.intensity;
    // pad on bar start
    if (s === 0) this.pad(chord, t, len * 16);
    // bass
    if (this.theme === 'menu') {
      if (s % 8 === 0) this.bass(song.bass[bar], t, len * 7, 0.22);
    } else {
      const pattern = [0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12];
      this.bass(song.bass[bar] + pattern[s], t, len * 0.9, s % 4 === 0 ? 0.3 : 0.2);
    }
    // drums
    if (song.drums) {
      if (s % 4 === 0) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
    }
    if (song.hats && (this.theme !== 'menu' ? true : s % 2 === 0)) this.hat(t, s % 4 === 2 ? 0.06 : 0.03);
    // arp
    if (song.arp) {
      const notes = [...chord, chord[0] + 12, chord[1] + 12];
      const order = [0, 2, 1, 3, 4, 2, 5, 3];
      const n = notes[order[s % order.length] % notes.length] + 12;
      if (this.theme === 'menu' ? s % 2 === 0 : true) this.arp(n, t, len * 0.8, this.theme === 'menu' ? 0.035 : 0.03);
    }
    // lead (race, higher intensity)
    if (song.lead && intense > 0.7 && (s === 0 || s === 6 || s === 10)) {
      this.lead(chord[(s / 2) % chord.length] + 24, t, len * 3);
    }
  }

  private voice(type: OscillatorType, freq: number, t: number, dur: number, gain: number, cutoff: number, attack = 0.005, release = 0.1, reverb = 0.2, detune = 0): void {
    const ctx = this.audio.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    o.connect(f).connect(g).connect(this.bus!);
    if (reverb > 0) {
      const r = ctx.createGain();
      r.gain.value = reverb;
      g.connect(r).connect(this.audio.reverbSend);
    }
    o.start(t);
    o.stop(t + dur + release + 0.05);
  }

  private pad(chord: number[], t: number, dur: number): void {
    for (const n of chord) {
      this.voice('sawtooth', midi(n), t, dur, 0.022, 1100, 0.6, 0.6, 0.6, -8);
      this.voice('sawtooth', midi(n), t, dur, 0.022, 1100, 0.6, 0.6, 0.6, 8);
    }
  }

  private bass(n: number, t: number, dur: number, gain: number): void {
    this.voice('sawtooth', midi(n), t, dur, gain * 0.5, 420 + this.intensity * 500, 0.005, 0.05, 0);
    this.voice('square', midi(n - 12), t, dur, gain * 0.3, 200, 0.005, 0.05, 0);
  }

  private arp(n: number, t: number, dur: number, gain: number): void {
    this.voice('square', midi(n), t, dur, gain, 2600, 0.003, 0.08, 0.45);
  }

  private lead(n: number, t: number, dur: number): void {
    this.voice('sawtooth', midi(n), t, dur, 0.04, 3200, 0.02, 0.2, 0.6, 5);
  }

  private kick(t: number): void {
    const ctx = this.audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.4);
  }

  private snare(t: number): void {
    const ctx = this.audio.ctx!;
    const n = this.audio.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(f).connect(g).connect(this.bus!);
    const r = ctx.createGain();
    r.gain.value = 0.4;
    g.connect(r).connect(this.audio.reverbSend);
    n.start(t);
    n.stop(t + 0.25);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.18, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.15);
  }

  private hat(t: number, gain: number): void {
    const ctx = this.audio.ctx!;
    const n = this.audio.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f).connect(g).connect(this.bus!);
    n.start(t);
    n.stop(t + 0.07);
  }
}
