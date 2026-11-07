/**
 * Data definitions for the six APEX SHIFT 2099 vehicles.
 * All cars, manufacturers and names are original to this project.
 */

export interface VehiclePhysicsSpec {
  mass: number; // kg
  maxSpeed: number; // m/s (road)
  accel: number; // m/s^2 peak road acceleration
  brake: number; // m/s^2
  grip: number; // lateral acceleration limit (m/s^2) on road
  steerRate: number; // max yaw rate rad/s at low speed
  driftGrip: number; // fraction of grip while drifting
  hoverMaxSpeed: number;
  hoverAccel: number;
  hoverGrip: number;
  hoverSteer: number;
  hoverBrake: number;
  nitroForce: number; // extra m/s^2
  nitroSpeedBonus: number; // fraction of max speed
  nitroCapacity: number; // seconds of boost
  nitroRecharge: number; // seconds of boost regained per second (passive)
  transformTime: number; // seconds
  length: number;
  width: number;
  hoverHeight: number;
}

/** Cross-section station for the lofted body. All values in meters except t (0 = nose, 1 = tail). */
export interface BodyStation {
  t: number;
  w: number; // half width at beltline
  mid: number; // beltline height
  bot: number; // floor height
  sh: number; // shoulder / hood / deck height
  x0: number; // half width where upper body meets deck
  cw: number; // cabin half width at base (0 = no cabin)
  top: number; // roof height (>= sh)
  dip: number; // depth of hood valley between fenders
}

export type RimStyle = 'blade' | 'turbine' | 'mesh' | 'split' | 'disc';
export type WingStyle = 'none' | 'ducktail' | 'high' | 'swan' | 'twin' | 'blade';
export type HeadlightStyle = 'blade' | 'twin' | 'arrow' | 'bar' | 'ring';
export type TaillightStyle = 'bar' | 'twin' | 'vee' | 'ring';

export interface VehicleStyle {
  length: number;
  frontAxleT: number;
  rearAxleT: number;
  trackHalf: number;
  wheelRadius: number;
  tireWidth: number;
  rim: RimStyle;
  stations: BodyStation[];
  nb: number;
  nu: number;
  nc: number;
  glass: [number, number];
  wing: WingStyle;
  wingHeight: number;
  head: HeadlightStyle;
  tail: TaillightStyle;
  nozzles: 2 | 4;
  nozzleRadius: number;
  sharkFin: boolean;
  splitter: number;
  sideFins: number; // hover fin length
}

export interface EngineAudioProfile {
  base: number; // Hz at idle
  range: number; // Hz added at redline
  wave: OscillatorType;
  subWave: OscillatorType;
  detune: number;
  growl: number; // 0..1 distortion amount
  whine: number; // 0..1 turbine/electric whine level
  whineRatio: number;
  filter: number; // base lowpass cutoff
  gears: number;
  electric: boolean;
}

export interface VehicleSpec {
  id: string;
  name: string;
  maker: string;
  className: string;
  tagline: string;
  description: string;
  price: number;
  unlockedByDefault: boolean;
  physics: VehiclePhysicsSpec;
  style: VehicleStyle;
  audio: EngineAudioProfile;
  colors: { paint: string; accent: string; light: string; rim: string; hover: string };
}

const KMH = 1 / 3.6;

export const VEHICLES: VehicleSpec[] = [
  {
    id: 'vortex',
    name: 'VORTEX GT-R',
    maker: 'KAIYO DYNAMICS',
    className: 'ALL-ROUNDER',
    tagline: 'Balanced. Relentless. Proven.',
    description:
      'A mid-engine hyper-GT tuned for any circuit. Predictable at the limit with a strong road/hover balance — the benchmark every rival is measured against.',
    price: 0,
    unlockedByDefault: true,
    physics: {
      mass: 1420,
      maxSpeed: 396 * KMH,
      accel: 13.6,
      brake: 33,
      grip: 26.5,
      steerRate: 1.95,
      driftGrip: 0.55,
      hoverMaxSpeed: 428 * KMH,
      hoverAccel: 11.4,
      hoverGrip: 17.5,
      hoverSteer: 1.7,
      hoverBrake: 20,
      nitroForce: 12,
      nitroSpeedBonus: 0.16,
      nitroCapacity: 3.6,
      nitroRecharge: 0.04,
      transformTime: 0.85,
      length: 4.7,
      width: 2.06,
      hoverHeight: 0.75,
    },
    style: {
      length: 4.7,
      frontAxleT: 0.2,
      rearAxleT: 0.79,
      trackHalf: 0.86,
      wheelRadius: 0.36,
      tireWidth: 0.3,
      rim: 'blade',
      nb: 3.2,
      nu: 2.4,
      nc: 2.3,
      glass: [0.27, 0.63],
      stations: [
        { t: 0.0, w: 0.34, mid: 0.3, bot: 0.2, sh: 0.34, x0: 0.24, cw: 0, top: 0.34, dip: 0.0 },
        { t: 0.03, w: 0.8, mid: 0.3, bot: 0.13, sh: 0.44, x0: 0.62, cw: 0, top: 0.44, dip: 0.018 },
        { t: 0.1, w: 0.97, mid: 0.34, bot: 0.11, sh: 0.57, x0: 0.83, cw: 0, top: 0.57, dip: 0.048 },
        { t: 0.2, w: 1.03, mid: 0.4, bot: 0.11, sh: 0.7, x0: 0.86, cw: 0, top: 0.7, dip: 0.084 },
        { t: 0.27, w: 1.0, mid: 0.43, bot: 0.11, sh: 0.72, x0: 0.85, cw: 0.64, top: 0.76, dip: 0.042 },
        { t: 0.45, w: 0.97, mid: 0.46, bot: 0.11, sh: 0.74, x0: 0.86, cw: 0.6, top: 1.1, dip: 0.0 },
        { t: 0.56, w: 0.99, mid: 0.48, bot: 0.11, sh: 0.77, x0: 0.88, cw: 0.55, top: 1.12, dip: 0.0 },
        { t: 0.67, w: 1.03, mid: 0.5, bot: 0.11, sh: 0.83, x0: 0.92, cw: 0.44, top: 0.99, dip: 0.0 },
        { t: 0.79, w: 1.05, mid: 0.52, bot: 0.12, sh: 0.87, x0: 0.94, cw: 0.28, top: 0.91, dip: 0.024 },
        { t: 0.9, w: 1.01, mid: 0.56, bot: 0.18, sh: 0.87, x0: 0.9, cw: 0, top: 0.87, dip: 0.012 },
        { t: 1.0, w: 0.94, mid: 0.58, bot: 0.3, sh: 0.84, x0: 0.84, cw: 0, top: 0.84, dip: 0.0 },
      ],
      wing: 'swan',
      wingHeight: 1.12,
      head: 'blade',
      tail: 'bar',
      nozzles: 2,
      nozzleRadius: 0.085,
      sharkFin: false,
      splitter: 0.12,
      sideFins: 0.5,
    },
    audio: {
      base: 58,
      range: 300,
      wave: 'sawtooth',
      subWave: 'square',
      detune: 7,
      growl: 0.45,
      whine: 0.12,
      whineRatio: 7.1,
      filter: 900,
      gears: 7,
      electric: false,
    },
    colors: { paint: '#c4102b', accent: '#111317', light: '#eaf6ff', rim: '#2a2d33', hover: '#29e8ff' },
  },
  {
    id: 'spectre',
    name: 'SPECTRE X9',
    maker: 'ORION AEROWORKS',
    className: 'TOP SPEED',
    tagline: 'The fastest thing on asphalt.',
    description:
      'Long-tail aero streamliner with a fighter-style canopy. Highest top speed in class, but its lazy turn-in punishes ragged driving.',
    price: 0,
    unlockedByDefault: true,
    physics: {
      mass: 1360,
      maxSpeed: 418 * KMH,
      accel: 12.2,
      brake: 31,
      grip: 24.0,
      steerRate: 1.72,
      driftGrip: 0.6,
      hoverMaxSpeed: 452 * KMH,
      hoverAccel: 10.6,
      hoverGrip: 15.5,
      hoverSteer: 1.55,
      hoverBrake: 19,
      nitroForce: 11,
      nitroSpeedBonus: 0.17,
      nitroCapacity: 3.3,
      nitroRecharge: 0.04,
      transformTime: 0.9,
      length: 5.0,
      width: 2.0,
      hoverHeight: 0.72,
    },
    style: {
      length: 5.0,
      frontAxleT: 0.19,
      rearAxleT: 0.74,
      trackHalf: 0.84,
      wheelRadius: 0.35,
      tireWidth: 0.29,
      rim: 'disc',
      nb: 3.4,
      nu: 2.2,
      nc: 2.0,
      glass: [0.22, 0.56],
      stations: [
        { t: 0.0, w: 0.22, mid: 0.24, bot: 0.18, sh: 0.27, x0: 0.14, cw: 0, top: 0.27, dip: 0.0 },
        { t: 0.04, w: 0.72, mid: 0.26, bot: 0.12, sh: 0.38, x0: 0.58, cw: 0, top: 0.38, dip: 0.024 },
        { t: 0.12, w: 0.94, mid: 0.32, bot: 0.1, sh: 0.52, x0: 0.82, cw: 0, top: 0.52, dip: 0.06 },
        { t: 0.19, w: 1.0, mid: 0.38, bot: 0.1, sh: 0.64, x0: 0.86, cw: 0.0, top: 0.64, dip: 0.096 },
        { t: 0.25, w: 0.95, mid: 0.4, bot: 0.1, sh: 0.62, x0: 0.8, cw: 0.44, top: 0.7, dip: 0.072 },
        { t: 0.4, w: 0.9, mid: 0.42, bot: 0.1, sh: 0.64, x0: 0.76, cw: 0.46, top: 1.02, dip: 0.03 },
        { t: 0.52, w: 0.92, mid: 0.44, bot: 0.1, sh: 0.68, x0: 0.8, cw: 0.38, top: 0.98, dip: 0.012 },
        { t: 0.64, w: 0.98, mid: 0.46, bot: 0.1, sh: 0.76, x0: 0.88, cw: 0.26, top: 0.88, dip: 0.0 },
        { t: 0.74, w: 1.01, mid: 0.48, bot: 0.11, sh: 0.8, x0: 0.92, cw: 0.16, top: 0.84, dip: 0.024 },
        { t: 0.88, w: 0.9, mid: 0.5, bot: 0.18, sh: 0.76, x0: 0.8, cw: 0, top: 0.76, dip: 0.012 },
        { t: 1.0, w: 0.7, mid: 0.52, bot: 0.32, sh: 0.7, x0: 0.62, cw: 0, top: 0.7, dip: 0.0 },
      ],
      wing: 'blade',
      wingHeight: 0.86,
      head: 'arrow',
      tail: 'vee',
      nozzles: 2,
      nozzleRadius: 0.1,
      sharkFin: true,
      splitter: 0.1,
      sideFins: 0.6,
    },
    audio: {
      base: 72,
      range: 340,
      wave: 'sawtooth',
      subWave: 'triangle',
      detune: 12,
      growl: 0.2,
      whine: 0.5,
      whineRatio: 9.3,
      filter: 1300,
      gears: 8,
      electric: false,
    },
    colors: { paint: '#20242c', accent: '#00d9ff', light: '#d8f4ff', rim: '#15171b', hover: '#00e1ff' },
  },
  {
    id: 'raptor',
    name: 'RAPTOR HX',
    maker: 'VANTA MOTORSPORT',
    className: 'GRIP',
    tagline: 'Corners are where races are won.',
    description:
      'Wedge-nosed track weapon with a towering swan-neck wing. Monstrous downforce and braking — the king of tight circuits.',
    price: 0,
    unlockedByDefault: true,
    physics: {
      mass: 1290,
      maxSpeed: 382 * KMH,
      accel: 14.2,
      brake: 36,
      grip: 30.0,
      steerRate: 2.15,
      driftGrip: 0.52,
      hoverMaxSpeed: 406 * KMH,
      hoverAccel: 11.8,
      hoverGrip: 18.5,
      hoverSteer: 1.8,
      hoverBrake: 21,
      nitroForce: 11.5,
      nitroSpeedBonus: 0.15,
      nitroCapacity: 3.2,
      nitroRecharge: 0.045,
      transformTime: 0.85,
      length: 4.6,
      width: 2.1,
      hoverHeight: 0.75,
    },
    style: {
      length: 4.6,
      frontAxleT: 0.21,
      rearAxleT: 0.8,
      trackHalf: 0.89,
      wheelRadius: 0.37,
      tireWidth: 0.33,
      rim: 'split',
      nb: 3.6,
      nu: 3.0,
      nc: 2.6,
      glass: [0.3, 0.6],
      stations: [
        { t: 0.0, w: 0.5, mid: 0.2, bot: 0.14, sh: 0.24, x0: 0.4, cw: 0, top: 0.24, dip: 0.0 },
        { t: 0.04, w: 0.92, mid: 0.24, bot: 0.1, sh: 0.34, x0: 0.8, cw: 0, top: 0.34, dip: 0.012 },
        { t: 0.12, w: 1.04, mid: 0.32, bot: 0.09, sh: 0.52, x0: 0.9, cw: 0, top: 0.52, dip: 0.06 },
        { t: 0.21, w: 1.07, mid: 0.4, bot: 0.09, sh: 0.7, x0: 0.92, cw: 0, top: 0.7, dip: 0.12 },
        { t: 0.3, w: 1.02, mid: 0.44, bot: 0.09, sh: 0.72, x0: 0.88, cw: 0.6, top: 0.8, dip: 0.048 },
        { t: 0.45, w: 0.96, mid: 0.46, bot: 0.09, sh: 0.74, x0: 0.84, cw: 0.56, top: 1.1, dip: 0.0 },
        { t: 0.58, w: 1.0, mid: 0.48, bot: 0.09, sh: 0.8, x0: 0.9, cw: 0.5, top: 1.08, dip: 0.0 },
        { t: 0.7, w: 1.07, mid: 0.5, bot: 0.1, sh: 0.9, x0: 0.96, cw: 0.36, top: 1.0, dip: 0.0 },
        { t: 0.8, w: 1.09, mid: 0.52, bot: 0.11, sh: 0.94, x0: 0.98, cw: 0.22, top: 0.98, dip: 0.036 },
        { t: 0.91, w: 1.06, mid: 0.56, bot: 0.2, sh: 0.94, x0: 0.98, cw: 0, top: 0.94, dip: 0.024 },
        { t: 1.0, w: 1.02, mid: 0.6, bot: 0.34, sh: 0.92, x0: 0.96, cw: 0, top: 0.92, dip: 0.0 },
      ],
      wing: 'high',
      wingHeight: 1.38,
      head: 'twin',
      tail: 'twin',
      nozzles: 4,
      nozzleRadius: 0.065,
      sharkFin: true,
      splitter: 0.18,
      sideFins: 0.45,
    },
    audio: {
      base: 44,
      range: 250,
      wave: 'square',
      subWave: 'sawtooth',
      detune: 5,
      growl: 0.75,
      whine: 0.08,
      whineRatio: 6.2,
      filter: 750,
      gears: 6,
      electric: false,
    },
    colors: { paint: '#ffb000', accent: '#0d0e10', light: '#fff4e0', rim: '#121212', hover: '#ffd04a' },
  },
  {
    id: 'nova',
    name: 'NOVA ION',
    maker: 'LUMEN ELECTRIC',
    className: 'ACCELERATION',
    tagline: 'Zero to everything. Instantly.',
    description:
      'Quad-motor ion hypercar with a panoramic canopy. Savage launch and the quickest transformation in the field — top speed is merely excellent.',
    price: 12000,
    unlockedByDefault: false,
    physics: {
      mass: 1530,
      maxSpeed: 388 * KMH,
      accel: 15.4,
      brake: 33,
      grip: 25.5,
      steerRate: 2.0,
      driftGrip: 0.58,
      hoverMaxSpeed: 418 * KMH,
      hoverAccel: 12.6,
      hoverGrip: 16.8,
      hoverSteer: 1.75,
      hoverBrake: 20,
      nitroForce: 12.5,
      nitroSpeedBonus: 0.15,
      nitroCapacity: 3.0,
      nitroRecharge: 0.05,
      transformTime: 0.65,
      length: 4.5,
      width: 2.04,
      hoverHeight: 0.78,
    },
    style: {
      length: 4.5,
      frontAxleT: 0.19,
      rearAxleT: 0.81,
      trackHalf: 0.86,
      wheelRadius: 0.37,
      tireWidth: 0.3,
      rim: 'turbine',
      nb: 3.0,
      nu: 2.1,
      nc: 2.0,
      glass: [0.24, 0.74],
      stations: [
        { t: 0.0, w: 0.4, mid: 0.36, bot: 0.24, sh: 0.4, x0: 0.3, cw: 0, top: 0.4, dip: 0.0 },
        { t: 0.04, w: 0.86, mid: 0.36, bot: 0.14, sh: 0.52, x0: 0.7, cw: 0, top: 0.52, dip: 0.012 },
        { t: 0.12, w: 0.98, mid: 0.4, bot: 0.12, sh: 0.64, x0: 0.84, cw: 0, top: 0.64, dip: 0.024 },
        { t: 0.19, w: 1.02, mid: 0.44, bot: 0.12, sh: 0.72, x0: 0.86, cw: 0.0, top: 0.72, dip: 0.036 },
        { t: 0.24, w: 1.0, mid: 0.46, bot: 0.12, sh: 0.74, x0: 0.86, cw: 0.7, top: 0.78, dip: 0.012 },
        { t: 0.42, w: 0.98, mid: 0.48, bot: 0.12, sh: 0.76, x0: 0.86, cw: 0.66, top: 1.14, dip: 0.0 },
        { t: 0.58, w: 0.99, mid: 0.5, bot: 0.12, sh: 0.78, x0: 0.88, cw: 0.62, top: 1.12, dip: 0.0 },
        { t: 0.72, w: 1.02, mid: 0.52, bot: 0.12, sh: 0.82, x0: 0.9, cw: 0.5, top: 0.98, dip: 0.0 },
        { t: 0.81, w: 1.03, mid: 0.54, bot: 0.13, sh: 0.86, x0: 0.92, cw: 0.3, top: 0.9, dip: 0.012 },
        { t: 0.92, w: 0.99, mid: 0.58, bot: 0.2, sh: 0.86, x0: 0.9, cw: 0, top: 0.86, dip: 0.006 },
        { t: 1.0, w: 0.93, mid: 0.6, bot: 0.32, sh: 0.84, x0: 0.86, cw: 0, top: 0.84, dip: 0.0 },
      ],
      wing: 'ducktail',
      wingHeight: 0.9,
      head: 'bar',
      tail: 'bar',
      nozzles: 2,
      nozzleRadius: 0.07,
      sharkFin: false,
      splitter: 0.08,
      sideFins: 0.55,
    },
    audio: {
      base: 120,
      range: 900,
      wave: 'triangle',
      subWave: 'sine',
      detune: 3,
      growl: 0.0,
      whine: 0.9,
      whineRatio: 3.0,
      filter: 2200,
      gears: 1,
      electric: true,
    },
    colors: { paint: '#eef2f6', accent: '#2f6dff', light: '#e6f0ff', rim: '#c9ced6', hover: '#4d8bff' },
  },
  {
    id: 'titan',
    name: 'TITAN MK-IV',
    maker: 'HALVORSEN HEAVY',
    className: 'NITRO BRUISER',
    tagline: 'Built like a tank. Boosts like a rocket.',
    description:
      'Muscular grand tourer with a quad-nozzle nitro system and the biggest boost tank in the class. Heavy enough to shove rivals aside.',
    price: 16000,
    unlockedByDefault: false,
    physics: {
      mass: 1780,
      maxSpeed: 392 * KMH,
      accel: 12.9,
      brake: 31,
      grip: 24.8,
      steerRate: 1.78,
      driftGrip: 0.6,
      hoverMaxSpeed: 422 * KMH,
      hoverAccel: 10.8,
      hoverGrip: 16.0,
      hoverSteer: 1.6,
      hoverBrake: 19,
      nitroForce: 15,
      nitroSpeedBonus: 0.2,
      nitroCapacity: 4.8,
      nitroRecharge: 0.05,
      transformTime: 1.0,
      length: 4.85,
      width: 2.14,
      hoverHeight: 0.78,
    },
    style: {
      length: 4.85,
      frontAxleT: 0.2,
      rearAxleT: 0.78,
      trackHalf: 0.9,
      wheelRadius: 0.38,
      tireWidth: 0.34,
      rim: 'mesh',
      nb: 3.8,
      nu: 3.2,
      nc: 2.8,
      glass: [0.33, 0.6],
      stations: [
        { t: 0.0, w: 0.6, mid: 0.36, bot: 0.24, sh: 0.44, x0: 0.5, cw: 0, top: 0.44, dip: 0.0 },
        { t: 0.03, w: 0.98, mid: 0.38, bot: 0.15, sh: 0.6, x0: 0.86, cw: 0, top: 0.6, dip: 0.012 },
        { t: 0.1, w: 1.06, mid: 0.42, bot: 0.13, sh: 0.7, x0: 0.94, cw: 0, top: 0.7, dip: 0.03 },
        { t: 0.2, w: 1.08, mid: 0.46, bot: 0.13, sh: 0.78, x0: 0.96, cw: 0, top: 0.78, dip: 0.048 },
        { t: 0.33, w: 1.04, mid: 0.5, bot: 0.13, sh: 0.8, x0: 0.92, cw: 0.68, top: 0.86, dip: 0.024 },
        { t: 0.46, w: 1.02, mid: 0.52, bot: 0.13, sh: 0.82, x0: 0.9, cw: 0.64, top: 1.18, dip: 0.0 },
        { t: 0.58, w: 1.04, mid: 0.54, bot: 0.13, sh: 0.86, x0: 0.92, cw: 0.62, top: 1.17, dip: 0.0 },
        { t: 0.68, w: 1.08, mid: 0.56, bot: 0.13, sh: 0.92, x0: 0.98, cw: 0.5, top: 1.04, dip: 0.0 },
        { t: 0.78, w: 1.1, mid: 0.58, bot: 0.14, sh: 0.96, x0: 1.0, cw: 0.0, top: 0.96, dip: 0.024 },
        { t: 0.9, w: 1.08, mid: 0.6, bot: 0.2, sh: 0.96, x0: 1.0, cw: 0, top: 0.96, dip: 0.012 },
        { t: 1.0, w: 1.04, mid: 0.62, bot: 0.3, sh: 0.94, x0: 0.98, cw: 0, top: 0.94, dip: 0.0 },
      ],
      wing: 'twin',
      wingHeight: 1.16,
      head: 'twin',
      tail: 'ring',
      nozzles: 4,
      nozzleRadius: 0.08,
      sharkFin: false,
      splitter: 0.14,
      sideFins: 0.5,
    },
    audio: {
      base: 38,
      range: 230,
      wave: 'sawtooth',
      subWave: 'square',
      detune: 9,
      growl: 0.9,
      whine: 0.15,
      whineRatio: 5.4,
      filter: 650,
      gears: 6,
      electric: false,
    },
    colors: { paint: '#123c94', accent: '#ff6a10', light: '#fff1d6', rim: '#22252b', hover: '#ff8a2a' },
  },
  {
    id: 'phantom',
    name: 'PHANTOM ZERO',
    maker: 'ECLIPSE LABS',
    className: 'HOVER SPECIALIST',
    tagline: 'It was never meant to touch the ground.',
    description:
      'A prototype born for anti-gravity. Unmatched hover speed and stability with lightning-fast transformation, at the cost of road grip.',
    price: 22000,
    unlockedByDefault: false,
    physics: {
      mass: 1240,
      maxSpeed: 384 * KMH,
      accel: 13.2,
      brake: 31,
      grip: 24.2,
      steerRate: 1.85,
      driftGrip: 0.56,
      hoverMaxSpeed: 468 * KMH,
      hoverAccel: 13.2,
      hoverGrip: 21.5,
      hoverSteer: 1.95,
      hoverBrake: 24,
      nitroForce: 12,
      nitroSpeedBonus: 0.16,
      nitroCapacity: 3.4,
      nitroRecharge: 0.045,
      transformTime: 0.55,
      length: 4.9,
      width: 2.02,
      hoverHeight: 0.85,
    },
    style: {
      length: 4.9,
      frontAxleT: 0.18,
      rearAxleT: 0.77,
      trackHalf: 0.85,
      wheelRadius: 0.35,
      tireWidth: 0.29,
      rim: 'turbine',
      nb: 3.0,
      nu: 2.0,
      nc: 1.9,
      glass: [0.16, 0.52],
      stations: [
        { t: 0.0, w: 0.16, mid: 0.3, bot: 0.24, sh: 0.32, x0: 0.1, cw: 0, top: 0.32, dip: 0.0 },
        { t: 0.05, w: 0.66, mid: 0.3, bot: 0.14, sh: 0.44, x0: 0.5, cw: 0.0, top: 0.44, dip: 0.012 },
        { t: 0.12, w: 0.92, mid: 0.34, bot: 0.11, sh: 0.56, x0: 0.78, cw: 0.0, top: 0.56, dip: 0.072 },
        { t: 0.18, w: 1.0, mid: 0.38, bot: 0.11, sh: 0.66, x0: 0.86, cw: 0.0, top: 0.66, dip: 0.12 },
        { t: 0.22, w: 0.96, mid: 0.4, bot: 0.11, sh: 0.6, x0: 0.8, cw: 0.38, top: 0.68, dip: 0.084 },
        { t: 0.34, w: 0.9, mid: 0.42, bot: 0.11, sh: 0.6, x0: 0.74, cw: 0.44, top: 1.04, dip: 0.048 },
        { t: 0.48, w: 0.9, mid: 0.44, bot: 0.11, sh: 0.64, x0: 0.76, cw: 0.36, top: 1.0, dip: 0.024 },
        { t: 0.62, w: 0.98, mid: 0.46, bot: 0.11, sh: 0.74, x0: 0.86, cw: 0.22, top: 0.86, dip: 0.0 },
        { t: 0.77, w: 1.02, mid: 0.48, bot: 0.12, sh: 0.8, x0: 0.92, cw: 0.12, top: 0.82, dip: 0.036 },
        { t: 0.9, w: 0.92, mid: 0.5, bot: 0.2, sh: 0.76, x0: 0.82, cw: 0, top: 0.76, dip: 0.018 },
        { t: 1.0, w: 0.76, mid: 0.52, bot: 0.32, sh: 0.7, x0: 0.68, cw: 0, top: 0.7, dip: 0.0 },
      ],
      wing: 'none',
      wingHeight: 0.9,
      head: 'arrow',
      tail: 'vee',
      nozzles: 2,
      nozzleRadius: 0.11,
      sharkFin: true,
      splitter: 0.06,
      sideFins: 0.75,
    },
    audio: {
      base: 90,
      range: 520,
      wave: 'sawtooth',
      subWave: 'sine',
      detune: 18,
      growl: 0.1,
      whine: 0.7,
      whineRatio: 4.6,
      filter: 1600,
      gears: 4,
      electric: true,
    },
    colors: { paint: '#5b16b8', accent: '#00ffc6', light: '#e0fff8', rim: '#18121f', hover: '#00ffc6' },
  },
];

export function getVehicle(id: string): VehicleSpec {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

/** 0..10 display stat ratings derived from physics values. */
export interface StatRatings {
  speed: number;
  accel: number;
  handling: number;
  braking: number;
  hover: number;
  nitro: number;
}

export function ratePhysics(p: VehiclePhysicsSpec): StatRatings {
  const r = (v: number, lo: number, hi: number) => Math.max(1, Math.min(10, 1 + ((v - lo) / (hi - lo)) * 9));
  return {
    speed: r(p.maxSpeed * 3.6, 360, 450),
    accel: r(p.accel, 11, 18),
    handling: r(p.grip * 0.7 + p.steerRate * 6, 27, 34),
    braking: r(p.brake, 28, 40),
    hover: r(p.hoverMaxSpeed * 3.6 * 0.5 + p.hoverGrip * 10, 370, 470),
    nitro: r(p.nitroCapacity * p.nitroForce, 30, 80),
  };
}

export const PAINT_SWATCHES = [
  '#c4102b', '#ff3b30', '#ff6a10', '#ffb000', '#f2e600', '#5bd12f',
  '#00b36b', '#00c2c7', '#00d9ff', '#2f6dff', '#123c94', '#5b16b8',
  '#b5179e', '#ff2d95', '#eef2f6', '#9aa3ad', '#4a4f57', '#20242c',
  '#0b0c0f', '#7a5230', '#c9a227', '#3c6e47', '#86002a', '#003049',
];

export const LIGHT_SWATCHES = ['#eaf6ff', '#ffffff', '#fff1d6', '#29e8ff', '#ff2d95', '#a6ff00', '#ffb000', '#b18cff'];

export type PaintFinish = 'metallic' | 'pearl' | 'matte' | 'chrome' | 'gloss';
export const PAINT_FINISHES: PaintFinish[] = ['metallic', 'gloss', 'pearl', 'matte', 'chrome'];
