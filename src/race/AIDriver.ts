import { Vector3 } from 'three';
import { clamp, damp, lerp, mod, Rng } from '../core/utils';
import { RacingLine } from '../track/RacingLine';
import type { Track } from '../track/Track';
import { emptyInput, type DriveInput, type VehiclePhysics } from '../vehicles/VehiclePhysics';

export type Personality = 'aggressive' | 'technical' | 'defensive' | 'speed' | 'adaptive';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'apex';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'apex'];
export const PERSONALITIES: Personality[] = ['aggressive', 'technical', 'defensive', 'speed', 'adaptive'];

interface Traits {
  label: string;
  cornerSpeed: number; // multiplier on corner target speed
  lineFollow: number; // 0..1 (higher = tighter racing line)
  passGap: number; // lateral gap used when overtaking
  passEagerness: number; // 0..1
  defend: number; // 0..1
  nitroThreshold: number; // fraction of tank before using
  nitroStyle: 'exit' | 'straight' | 'defend' | 'smart';
  shortcut: number; // probability of taking hover shortcuts
  hoverBias: number; // >1 prefers hover longer
  mistakes: number; // multiplier
  rubberBand: number;
}

export const TRAITS: Record<Personality, Traits> = {
  aggressive: { label: 'AGGRESSIVE', cornerSpeed: 1.025, lineFollow: 0.85, passGap: 2.7, passEagerness: 1, defend: 0.3, nitroThreshold: 0.25, nitroStyle: 'exit', shortcut: 0.75, hoverBias: 1, mistakes: 1.4, rubberBand: 1 },
  technical: { label: 'TECHNICAL', cornerSpeed: 1.0, lineFollow: 1, passGap: 3.4, passEagerness: 0.6, defend: 0.4, nitroThreshold: 0.6, nitroStyle: 'exit', shortcut: 0.5, hoverBias: 0.9, mistakes: 0.5, rubberBand: 0.8 },
  defensive: { label: 'DEFENSIVE', cornerSpeed: 0.985, lineFollow: 0.9, passGap: 3.6, passEagerness: 0.45, defend: 1, nitroThreshold: 0.5, nitroStyle: 'defend', shortcut: 0.35, hoverBias: 1, mistakes: 0.8, rubberBand: 0.9 },
  speed: { label: 'SPEED SPECIALIST', cornerSpeed: 0.975, lineFollow: 0.9, passGap: 3.2, passEagerness: 0.8, defend: 0.25, nitroThreshold: 0.45, nitroStyle: 'straight', shortcut: 0.95, hoverBias: 1.35, mistakes: 1, rubberBand: 0.9 },
  adaptive: { label: 'ADAPTIVE', cornerSpeed: 1.0, lineFollow: 0.95, passGap: 3.1, passEagerness: 0.75, defend: 0.6, nitroThreshold: 0.4, nitroStyle: 'smart', shortcut: 0.7, hoverBias: 1.1, mistakes: 0.9, rubberBand: 1.8 },
};

export const DIFFICULTY_SETTINGS: Record<Difficulty, { label: string; skill: number; mistakes: number; reaction: number; rubber: number; reward: number }> = {
  easy: { label: 'EASY', skill: 0.85, mistakes: 1.8, reaction: 0.45, rubber: 1, reward: 0.7 },
  normal: { label: 'NORMAL', skill: 0.925, mistakes: 1, reaction: 0.3, rubber: 0.8, reward: 1 },
  hard: { label: 'HARD', skill: 0.975, mistakes: 0.6, reaction: 0.18, rubber: 0.55, reward: 1.35 },
  apex: { label: 'APEX', skill: 1.005, mistakes: 0.3, reaction: 0.1, rubber: 0.35, reward: 1.8 },
};

/** Shared per-track AI data (racing lines + mode preferences). */
export class TrackAIData {
  readonly lines: RacingLine[];
  constructor(public readonly track: Track) {
    this.lines = track.paths.map((p) => new RacingLine(p, p.index === 0 ? 2.8 : 1.6));
  }
}

interface Profiles {
  road: Float32Array[];
  hover: Float32Array[];
  preferHover: Uint8Array[];
}

type MistakeKind = 'none' | 'lateBrake' | 'earlyLift' | 'wide' | 'wobble';

export interface AIContext {
  cars: VehiclePhysics[];
  progress: number[]; // race progress (m) per car index, same order as cars
  myIndex: number;
  playerIndex: number; // -1 if none
  raceTime: number;
}

const _to = new Vector3();
const _tp = new Vector3();

export class AIDriver {
  readonly input: DriveInput = emptyInput();
  readonly traits: Traits;
  readonly diff: (typeof DIFFICULTY_SETTINGS)[Difficulty];
  private profiles: Profiles;
  private rng: Rng;
  private offsetBias = 0;
  private avoidOffset = 0;
  private mistake: MistakeKind = 'none';
  private mistakeTimer = 0;
  private lastCornerIdx = -1;
  private stuckTimer = 0;
  private reverseTimer = 0;
  private wrongWayTimer = 0;
  private modeTimer = 0;
  private startDelay: number;
  private takeShortcut = -1; // branch path index chosen, -1 none
  private shortcutDecidedFor = -1;
  private steerSmoothed = 0;
  skillMod = 1;
  needsRespawn = false;

  constructor(
    public readonly car: VehiclePhysics,
    private readonly ai: TrackAIData,
    public readonly personality: Personality,
    public readonly difficulty: Difficulty,
    seed: number,
  ) {
    this.traits = TRAITS[personality];
    this.diff = DIFFICULTY_SETTINGS[difficulty];
    this.rng = new Rng(seed);
    this.startDelay = this.diff.reaction * (0.4 + this.rng.float());
    this.offsetBias = this.rng.range(-1, 1) * (1 - this.traits.lineFollow) * 3;
    this.profiles = this.buildProfiles();
  }

  /** Rebuild speed profiles (e.g. after spec change). */
  private buildProfiles(): Profiles {
    const sp = this.car.spec;
    const road: Float32Array[] = [];
    const hover: Float32Array[] = [];
    const preferHover: Uint8Array[] = [];
    for (const line of this.ai.lines) {
      const r = line.speedProfile(sp.grip * 0.96, sp.accel, sp.brake * 0.82, sp.maxSpeed);
      const h = line.speedProfile(sp.hoverGrip * 1.05, sp.hoverAccel, sp.hoverBrake * 0.85, sp.hoverMaxSpeed);
      road.push(r);
      hover.push(h);
      const n = r.length;
      const pref = new Uint8Array(n);
      const win = Math.round(380 / line.path.spacing);
      const raw = new Float32Array(n);
      for (let i = 0; i < n; i++) raw[i] = h[i] * this.traits.hoverBias - r[i];
      for (let i = 0; i < n; i++) {
        // Hover is preferred if, over the upcoming window, it is not slower anywhere by much
        // and is faster on average.
        let sum = 0;
        let worst = Infinity;
        for (let k = 0; k < win; k += 3) {
          const j = line.path.closed ? mod(i + k, n) : Math.min(n - 1, i + k);
          sum += raw[j];
          worst = Math.min(worst, raw[j]);
        }
        pref[i] = sum / (win / 3) > 1.2 && worst > -9 ? 1 : 0;
      }
      if (line.path.hoverOnly) pref.fill(1);
      preferHover.push(pref);
    }
    return { road, hover, preferHover };
  }

  refreshProfiles(): void {
    this.profiles = this.buildProfiles();
  }

  update(dt: number, ctx: AIContext): DriveInput {
    const car = this.car;
    const inp = this.input;
    const track = this.ai.track;
    const path = car.path;
    const pi = car.pathIndex;
    const line = this.ai.lines[pi];
    const proj = car.proj;
    const n = path.count;
    const idx = proj.index;
    const v = Math.max(0, car.speed);

    inp.transform = false;
    inp.nitro = false;

    if (ctx.raceTime < this.startDelay) {
      inp.throttle = 0;
      inp.brake = 0;
      inp.steer = 0;
      return inp;
    }

    // ---- rubber band / adaptive skill ------------------------------------
    let skill = this.diff.skill;
    if (ctx.playerIndex >= 0 && ctx.playerIndex !== ctx.myIndex) {
      const gap = ctx.progress[ctx.playerIndex] - ctx.progress[ctx.myIndex];
      const rb = this.diff.rubber * this.traits.rubberBand;
      skill += clamp(gap / 500, -0.035, 0.045) * rb;
    }
    this.skillMod = damp(this.skillMod, skill, 0.5, dt);

    // ---- mistakes -----------------------------------------------------------
    const prof = car.isHover ? this.profiles.hover[pi] : this.profiles.road[pi];
    const ahead = (k: number) => (path.closed ? mod(idx + k, n) : Math.min(n - 1, idx + k));
    const brakeLook = Math.round((v * 0.35) / path.spacing) + 2;
    let targetV = prof[ahead(brakeLook)];
    if (this.mistakeTimer > 0) {
      this.mistakeTimer -= dt;
      if (this.mistakeTimer <= 0) this.mistake = 'none';
    } else if (targetV < v - 12 && Math.abs(idx - this.lastCornerIdx) > 60) {
      this.lastCornerIdx = idx;
      const p = 0.07 * this.diff.mistakes * this.traits.mistakes;
      if (this.rng.chance(p)) {
        this.mistake = this.rng.pick<MistakeKind>(['lateBrake', 'earlyLift', 'wide', 'wobble']);
        this.mistakeTimer = this.rng.range(1, 2.2);
      }
    }

    // ---- shortcut decision -------------------------------------------------
    let wantHover = this.profiles.preferHover[pi][idx] === 1;
    let lateralTarget = line.offset[ahead(4)] * lerp(0.75, 1, this.traits.lineFollow) + this.offsetBias;
    let entering = false;
    if (pi === 0) {
      const L = track.length;
      const half = proj.width / 2;
      for (const b of track.branches) {
        let dist = b.entryS - proj.s;
        if (dist < -L / 2) dist += L;
        if (dist > L / 2) dist -= L;
        if (dist > 0 && dist < 520 && this.shortcutDecidedFor !== b.index) {
          this.shortcutDecidedFor = b.index;
          const chance = this.traits.shortcut * clamp(this.skillMod, 0.7, 1.05);
          this.takeShortcut = this.rng.chance(chance) ? b.index : -1;
        }
        if (dist < -60 && this.shortcutDecidedFor === b.index) {
          // Passed the entry while still on the main road: forget the decision.
          this.shortcutDecidedFor = -1;
          if (this.takeShortcut === b.index) this.takeShortcut = -1;
        }
        const taking = this.takeShortcut === b.index;
        if (taking && dist < 70 && dist > -10 && car.transform < 0.9) this.takeShortcut = -1; // not ready: abort
        const sideOpen = b.side > 0 ? proj.connR === b.index : proj.connL === b.index;
        if (dist > -60 && dist < 520 && this.takeShortcut === b.index) {
          wantHover = true;
          if (dist < 170) {
            lateralTarget = b.side * (half - 2.2);
            entering = true;
          }
          if (sideOpen) lateralTarget = b.side * (half + 2.5);
        } else if (sideOpen || (dist > -60 && dist < 150)) {
          // Not taking it: stay clear of the open edge.
          lateralTarget = Math.min(lateralTarget * b.side, half - 5) * b.side;
        }
        // Approaching the merge point of a branch: leave room on that side.
        let toExit = b.exitS - proj.s;
        if (toExit < -L / 2) toExit += L;
        if (toExit > 0 && toExit < 90) lateralTarget = Math.min(lateralTarget * b.side, half - 4) * b.side;
      }
    } else {
      wantHover = true;
      lateralTarget = 0;
      this.takeShortcut = -1;
    }

    // Hover lanes: hover cars prefer the lane.
    if (car.isHover && !isNaN(proj.hoverLane) && pi === 0) lateralTarget = lerp(lateralTarget, proj.hoverLane, 0.75);

    // ---- traffic: overtaking, avoidance, defending ---------------------------
    let followSpeed = Infinity;
    let avoid = 0;
    const myProg = ctx.progress[ctx.myIndex];
    for (let k = 0; k < ctx.cars.length; k++) {
      if (k === ctx.myIndex) continue;
      const o = ctx.cars[k];
      if (o.fallen || o.ghost > 0) continue;
      const ds = ctx.progress[k] - myProg;
      if (ds < -30 || ds > 45) continue;
      if (Math.abs(o.pos.y - car.pos.y) > 4) continue;
      _to.subVectors(o.pos, car.pos);
      const lat = _to.dot(proj.right) + proj.lateral;
      const dLat = lat - proj.lateral;
      if (ds > 0) {
        // car ahead
        const closing = v - Math.max(0, o.speed);
        if (Math.abs(dLat) < this.traits.passGap && ds < 8 + Math.max(0, closing) * 1.6) {
          const half = proj.width / 2 - 2;
          const spaceL = lat + half; // room on the left (negative lateral)
          const spaceR = half - lat;
          const dir = spaceR > spaceL ? 1 : -1;
          const room = Math.max(spaceL, spaceR);
          if (room > this.traits.passGap && this.traits.passEagerness > 0.3) {
            avoid += dir * (this.traits.passGap - Math.abs(dLat)) * 1.2;
          } else if (ds < 14) {
            followSpeed = Math.min(followSpeed, Math.max(0, o.speed) - (this.personality === 'aggressive' ? -2 : 1));
          }
        }
        if (ds < 6 && Math.abs(dLat) < 2.4) followSpeed = Math.min(followSpeed, Math.max(0, o.speed) - 1.5);
      } else {
        // car behind / alongside
        if (Math.abs(ds) < 5 && Math.abs(dLat) < 3.2) avoid -= Math.sign(dLat || 1) * (3.2 - Math.abs(dLat)) * 0.8;
        if (ds < -2 && ds > -22 && this.traits.defend > 0.5 && targetV > v - 5) {
          const block = clamp(lat, proj.lateral - 2.5, proj.lateral + 2.5);
          lateralTarget = lerp(lateralTarget, block, 0.35 * this.traits.defend);
        }
      }
    }
    this.avoidOffset = damp(this.avoidOffset, avoid, 2.2, dt);
    lateralTarget += this.avoidOffset;
    if (this.mistake === 'wide') lateralTarget += -Math.sign(line.signedCurvature[ahead(20)] || 1) * 3;
    const halfW = entering ? proj.width / 2 + 3 : proj.width / 2 - 1.6;
    lateralTarget = clamp(lateralTarget, -halfW, halfW);

    // ---- speed target --------------------------------------------------------
    targetV *= this.skillMod * this.traits.cornerSpeed;
    if (car.inHoverLane) targetV *= 1.05;
    if (this.mistake === 'lateBrake') targetV *= 1.13;
    if (this.mistake === 'earlyLift') targetV *= 0.86;
    targetV = Math.min(targetV, followSpeed);
    if (path.hoverOnly) targetV = car.spec.hoverMaxSpeed * 1.2;

    // ---- steering: pure pursuit ------------------------------------------------
    const look = clamp(9 + v * 0.38, 11, 52);
    const lookIdx = ahead(Math.round(look / path.spacing));
    const lookOff = entering ? lateralTarget : lerp(lateralTarget, line.offset[lookIdx] + this.offsetBias, 0.3);
    const lookSmp = path.samples[lookIdx];
    _tp.copy(lookSmp.pos).addScaledVector(lookSmp.right, path.hoverOnly ? 0 : lookOff * 0.5 + lateralTarget * 0.5);
    _to.subVectors(_tp, car.pos);
    const fwd = _to.dot(car.forward);
    const rgt = _to.dot(car.right);
    const alpha = Math.atan2(rgt, Math.max(0.1, fwd));
    const sp = car.spec;
    const m = car.hoverBlend;
    const steerRate = lerp(sp.steerRate, sp.hoverSteer, m);
    const grip = lerp(sp.grip, sp.hoverGrip, m);
    const lowF = clamp(v / 5, 0, 1);
    const highF = 0.3 + 0.7 / (1 + v / 48);
    const maxRate = Math.max(0.05, Math.min(steerRate * lowF * highF, (grip * (m > 0.5 ? 1.25 : 1.08)) / Math.max(v, 4)));
    const desiredRate = (2 * Math.sin(alpha) * Math.max(v, 3)) / look;
    let steer = clamp(desiredRate / maxRate + alpha * 0.4, -1, 1);
    if (this.mistake === 'wobble') steer += Math.sin(ctx.raceTime * 7) * 0.25;
    this.steerSmoothed = damp(this.steerSmoothed, steer, 14, dt);
    inp.steer = clamp(this.steerSmoothed, -1, 1);

    // ---- throttle / brake --------------------------------------------------------
    const err = targetV - v;
    if (err > 1.5) {
      inp.throttle = 1;
      inp.brake = 0;
    } else if (err > -1.5) {
      inp.throttle = clamp(0.55 + err * 0.25, 0, 1);
      inp.brake = 0;
    } else {
      inp.throttle = 0;
      inp.brake = clamp(-err / 9, 0.15, 1);
    }

    // ---- mode switching ------------------------------------------------------------
    this.modeTimer -= dt;
    const curv = Math.abs(line.signedCurvature[idx]);
    if (this.modeTimer <= 0 && curv < 0.012 && car.grounded) {
      if (wantHover !== car.targetHover) {
        inp.transform = true;
        this.modeTimer = 2.5 + this.rng.float() * 1.5;
      }
    }
    // Never be in road mode on a hover-only path.
    if (path.hoverOnly && !car.targetHover && this.modeTimer < 1.5) inp.transform = true;

    // ---- nitro ------------------------------------------------------------------------
    const tank = car.nitro / sp.nitroCapacity;
    const winIdx = ahead(Math.round(180 / path.spacing));
    const straightAhead = prof[winIdx] > v + 8 && targetV > v + 3;
    if (tank > this.traits.nitroThreshold || car.nitroActive) {
      let use = false;
      switch (this.traits.nitroStyle) {
        case 'exit':
          use = straightAhead && inp.throttle > 0.9;
          break;
        case 'straight':
          use = straightAhead && prof[ahead(Math.round(320 / path.spacing))] > v + 15;
          break;
        case 'defend': {
          let threatened = false;
          for (let k = 0; k < ctx.cars.length; k++) {
            if (k === ctx.myIndex) continue;
            const ds = ctx.progress[k] - myProg;
            if (ds < 0 && ds > -18) threatened = true;
            if (ds > 0 && ds < 25) threatened = true;
          }
          use = straightAhead && (threatened || tank > 0.95);
          break;
        }
        case 'smart': {
          const behindPlayer = ctx.playerIndex >= 0 && ctx.progress[ctx.playerIndex] > myProg;
          use = straightAhead && (behindPlayer || tank > 0.85);
          break;
        }
      }
      inp.nitro = use && inp.brake === 0;
    }

    // ---- recovery -------------------------------------------------------------------------
    const facing = car.forward.dot(proj.tangent);
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = -Math.sign(alpha || 1);
      inp.nitro = false;
    } else if (v < 2.5 && inp.throttle > 0.5 && ctx.raceTime > 4) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.6) {
        this.reverseTimer = 1.1;
        this.stuckTimer = 0;
      }
    } else this.stuckTimer = Math.max(0, this.stuckTimer - dt);
    if (facing < -0.2) this.wrongWayTimer += dt;
    else this.wrongWayTimer = 0;
    this.needsRespawn = this.wrongWayTimer > 4;
    if (this.needsRespawn) this.wrongWayTimer = 0;

    return inp;
  }
}
