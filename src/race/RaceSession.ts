import { clamp, damp, Rng } from '../core/utils';
import { Track } from '../track/Track';
import { getTrackDef } from '../track/TrackDefinitions';
import { VehiclePhysics, resolveCarCollisions, emptyInput, type DriveInput } from '../vehicles/VehiclePhysics';
import { applyUpgrades, emptyUpgrades } from '../vehicles/Upgrades';
import { getVehicle } from '../vehicles/VehicleSpecs';
import { AIDriver, TrackAIData, type Difficulty } from './AIDriver';
import { RIVALS, type DriverProfile, type RaceConfig } from './RaceConfig';

export interface RacerInfo {
  id: string;
  name: string;
  short: string;
  carId: string;
  isPlayer: boolean;
  paint: string;
  profile?: DriverProfile;
}

export class Racer {
  input: DriveInput = emptyInput();
  progress = 0; // cumulative distance along the main track (m)
  lastMainS = 0;
  lapsCompleted = -1;
  lapStart = 0;
  lapTimes: number[] = [];
  bestLap = Infinity;
  finished = false;
  finishTime = Infinity;
  position = 1;
  wrongWay = false;
  private wrongWayTimer = 0;
  respawnTimer = 0;
  respawns = 0;
  checkpoint = 0;
  splitTimes: number[] = [];

  constructor(
    public readonly index: number,
    public readonly info: RacerInfo,
    public readonly physics: VehiclePhysics,
    public readonly ai: AIDriver | null,
  ) {}

  get currentLap(): number {
    return Math.max(1, this.lapsCompleted + 1);
  }

  updateWrongWay(dt: number): void {
    const p = this.physics;
    const back = p.forward.dot(p.proj.tangent) < -0.4 && Math.abs(p.speed) > 4;
    this.wrongWayTimer = back ? this.wrongWayTimer + dt : Math.max(0, this.wrongWayTimer - dt * 2);
    this.wrongWay = this.wrongWayTimer > 1.2;
  }
}

export type RaceEvent =
  | { type: 'lap'; racer: Racer; lap: number; time: number; best: boolean }
  | { type: 'finalLap'; racer: Racer }
  | { type: 'finish'; racer: Racer; position: number; time: number }
  | { type: 'respawn'; racer: Racer }
  | { type: 'go' }
  | { type: 'countdown'; value: number }
  | { type: 'checkpoint'; racer: Racer; index: number; time: number };

export type RaceState = 'countdown' | 'racing' | 'finished';

const SUBSTEP = 1 / 120;

export class RaceSession {
  readonly track: Track;
  readonly ai: TrackAIData;
  readonly racers: Racer[] = [];
  readonly player: Racer | null;
  state: RaceState = 'countdown';
  countdown: number;
  time = 0; // race clock (since GO)
  events: RaceEvent[] = [];
  readonly laps: number;
  private lastCount = 4;
  private finishOrder = 0;
  private finishGrace = 0;
  readonly physicsList: VehiclePhysics[] = [];
  private progressArr: number[] = [];

  constructor(
    public readonly config: RaceConfig,
    track?: Track,
    aiData?: TrackAIData,
    opts: { withPlayer?: boolean; countdown?: number } = {},
  ) {
    this.track = track ?? new Track(getTrackDef(config.trackId));
    this.ai = aiData ?? new TrackAIData(this.track);
    this.laps = config.laps;
    this.countdown = opts.countdown ?? 3.999;
    const withPlayer = opts.withPlayer ?? true;
    const rng = new Rng(config.seed ?? 1234);
    const opponents = config.mode === 'timetrial' ? 0 : clamp(config.opponents, 0, 7);
    const total = Math.min(opponents, config.rivalIds ? config.rivalIds.length : opponents) + (withPlayer ? 1 : 0);
    // Player starts at the back-ish (position per mode), AI fill the grid.
    const playerSlot = withPlayer ? (config.mode === 'timetrial' ? 0 : Math.min(total - 1, Math.max(0, total - 1 - (config.mode === 'championship' ? 1 : 0)))) : -1;
    const rivals = config.rivalIds
      ? config.rivalIds.map((id) => RIVALS.find((r) => r.id === id)).filter((r): r is DriverProfile => !!r).slice(0, opponents)
      : shuffled(RIVALS, rng).slice(0, opponents);
    let r = 0;
    for (let slot = 0; slot < total; slot++) {
      const isPlayer = slot === playerSlot;
      let info: RacerInfo;
      let ups = emptyUpgrades();
      if (isPlayer) {
        info = { id: 'player', name: 'YOU', short: 'YOU', carId: config.playerCar, isPlayer: true, paint: '#ffffff' };
        ups = config.playerUpgrades;
      } else {
        const prof = rivals[r++];
        info = { id: prof.id, name: prof.name, short: prof.short, carId: prof.carId, isPlayer: false, paint: prof.paint, profile: prof };
        const lvl = aiUpgradeLevel(config.difficulty);
        ups = { engine: lvl, nitro: lvl, handling: lvl, hover: lvl };
      }
      const spec = applyUpgrades(getVehicle(info.carId).physics, ups);
      const phys = new VehiclePhysics(spec, this.track);
      const g = this.track.gridSlot(slot);
      phys.placeAt(g.s, g.lateral, 0, 0);
      phys.frozen = true;
      const ai = isPlayer || !info.profile ? null : new AIDriver(phys, this.ai, info.profile.personality, config.difficulty as Difficulty, (config.seed ?? 99) * 31 + slot * 7);
      const racer = new Racer(slot, info, phys, ai);
      racer.lastMainS = g.s;
      racer.progress = g.s - this.track.length;
      this.racers.push(racer);
      this.physicsList.push(phys);
    }
    this.player = this.racers.find((x) => x.info.isPlayer) ?? null;
    this.progressArr = this.racers.map((x) => x.progress);
    this.updatePositions();
  }

  get playerIndex(): number {
    return this.player ? this.player.index : -1;
  }

  /** Advance simulation. playerInput is applied to the player racer. */
  update(dt: number, playerInput?: DriveInput): void {
    dt = Math.min(dt, 1 / 20);
    for (const p of this.physicsList) p.beginFrame();

    if (this.state === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c !== this.lastCount && c >= 0) {
        this.lastCount = c;
        if (c > 0) this.events.push({ type: 'countdown', value: c });
      }
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.time = 0;
        for (const r of this.racers) {
          r.physics.frozen = false;
          r.lapStart = 0;
        }
        this.events.push({ type: 'go' });
      }
    } else {
      this.time += dt;
    }

    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / steps;
    // Controllers update once per frame.
    for (const r of this.racers) {
      if (r.info.isPlayer) {
        if (playerInput) Object.assign(r.input, playerInput);
        if (r.finished && r.ai === null) {
          // autopilot-ish coast after finish
          r.input.throttle = 0.3;
          r.input.brake = 0;
          r.input.nitro = false;
        }
      } else if (r.ai) {
        const inp = r.ai.update(dt, { cars: this.physicsList, progress: this.progressArr, myIndex: r.index, playerIndex: this.playerIndex, raceTime: this.time });
        Object.assign(r.input, inp);
        if (this.state === 'countdown') {
          // AI revs on the grid
          r.input.throttle = Math.random() < 0.02 ? 1 : r.input.throttle * 0.9;
        }
      }
    }
    for (let i = 0; i < steps; i++) {
      for (const r of this.racers) {
        r.physics.step(h, r.input);
        // edge-triggered inputs only on first substep
      }
      for (const r of this.racers) r.input.transform = false;
      resolveCarCollisions(this.physicsList);
    }

    for (const r of this.racers) this.updateRacer(r, dt);
    this.updateSlipstream(dt);
    this.updatePositions();
    this.checkFinished(dt);
  }

  private updateRacer(r: Racer, dt: number): void {
    const p = r.physics;
    const L = this.track.length;
    // Respawn handling
    if (p.fallen || r.ai?.needsRespawn) {
      r.respawnTimer += dt;
      if (r.respawnTimer > (p.fallen ? 1.0 : 0.1)) {
        p.respawn();
        r.respawnTimer = 0;
        r.respawns++;
        if (r.ai) r.ai.needsRespawn = false;
        this.events.push({ type: 'respawn', racer: r });
        r.lastMainS = this.track.mainS(p.pathIndex, p.proj.s);
      }
    }
    const mainS = this.track.mainS(p.pathIndex, p.proj.s);
    let delta = mainS - r.lastMainS;
    if (delta < -L / 2) delta += L;
    if (delta > L / 2) delta -= L;
    r.lastMainS = mainS;
    if (this.state === 'countdown') return;
    r.progress += delta;
    this.progressArr[r.index] = r.progress;
    r.updateWrongWay(dt);
    if (r.finished) return;

    // checkpoints (split times)
    const cpLen = L / this.track.numCheckpoints;
    const cpIdx = Math.floor(r.progress / cpLen);
    if (cpIdx > r.checkpoint) {
      r.checkpoint = cpIdx;
      if (cpIdx % this.track.numCheckpoints !== 0) this.events.push({ type: 'checkpoint', racer: r, index: cpIdx, time: this.time });
    }

    const laps = Math.floor(r.progress / L);
    if (laps > r.lapsCompleted) {
      const prev = r.lapsCompleted;
      r.lapsCompleted = laps;
      if (prev >= 0) {
        const lapTime = this.time - r.lapStart;
        r.lapTimes.push(lapTime);
        const best = lapTime < r.bestLap;
        if (best) r.bestLap = lapTime;
        this.events.push({ type: 'lap', racer: r, lap: prev + 1, time: lapTime, best });
      }
      r.lapStart = this.time;
      if (r.lapsCompleted >= this.laps) {
        r.finished = true;
        r.finishTime = this.time;
        this.finishOrder++;
        this.events.push({ type: 'finish', racer: r, position: this.finishOrder, time: this.time });
      } else if (r.lapsCompleted === this.laps - 1 && this.laps > 1) {
        this.events.push({ type: 'finalLap', racer: r });
      }
    }
  }

  private updateSlipstream(dt: number): void {
    for (const r of this.racers) {
      let best = 0;
      for (const o of this.racers) {
        if (o === r) continue;
        const gap = o.progress - r.progress;
        if (gap < 4 || gap > 34) continue;
        const dLat = Math.abs(o.physics.proj.lateral - r.physics.proj.lateral);
        if (dLat > 2.4 || o.physics.pathIndex !== r.physics.pathIndex) continue;
        best = Math.max(best, 1 - (gap - 4) / 30);
      }
      r.physics.draft = damp(r.physics.draft, Math.abs(r.physics.speed) > 25 ? best : 0, 3, dt);
    }
  }

  updatePositions(): void {
    const sorted = [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((r, i) => (r.position = i + 1));
  }

  get standings(): Racer[] {
    return [...this.racers].sort((a, b) => a.position - b.position);
  }

  private checkFinished(dt: number): void {
    if (this.state !== 'racing') return;
    const allDone = this.racers.every((r) => r.finished);
    const playerDone = this.player ? this.player.finished : allDone;
    if (playerDone) this.finishGrace += dt;
    if (allDone || (playerDone && this.finishGrace > 25)) {
      // Estimate times for anyone still running.
      const L = this.track.length;
      for (const r of this.racers) {
        if (r.finished) continue;
        const remaining = this.laps * L - r.progress;
        const avg = Math.max(20, r.progress / Math.max(1, this.time));
        r.finishTime = this.time + remaining / avg;
        r.finished = true;
      }
      this.updatePositions();
      this.state = 'finished';
    }
  }


  /** Gap in seconds between two racers based on progress and speed. */
  gapSeconds(a: Racer, b: Racer): number {
    const d = b.progress - a.progress;
    const v = Math.max(15, (Math.abs(a.physics.speed) + Math.abs(b.physics.speed)) / 2);
    return d / v;
  }
}

function aiUpgradeLevel(d: string): number {
  return d === 'easy' ? 0 : d === 'normal' ? 1 : d === 'hard' ? 2 : 3;
}

function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.float() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
