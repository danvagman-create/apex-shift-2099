import type { Difficulty, Personality } from './AIDriver';
import type { UpgradeLevels } from '../vehicles/Upgrades';

export type RaceMode = 'quick' | 'timetrial' | 'championship';

export interface RaceConfig {
  mode: RaceMode;
  trackId: string;
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  playerCar: string;
  playerUpgrades: UpgradeLevels;
  cupId?: string;
  seed?: number;
}

export interface DriverProfile {
  id: string;
  name: string;
  short: string;
  personality: Personality;
  carId: string;
  paint: string;
  country: string;
}

/** Fictional rival roster. */
export const RIVALS: DriverProfile[] = [
  { id: 'sato', name: 'IKARI SATO', short: 'SATO', personality: 'technical', carId: 'raptor', paint: '#e8e8ea', country: 'JP' },
  { id: 'voss', name: 'LENA VOSS', short: 'VOSS', personality: 'aggressive', carId: 'vortex', paint: '#ff2d55', country: 'DE' },
  { id: 'strom', name: 'MAREK STROM', short: 'STROM', personality: 'speed', carId: 'spectre', paint: '#00c2c7', country: 'NO' },
  { id: 'ko', name: 'JADE KO', short: 'KO', personality: 'adaptive', carId: 'phantom', paint: '#a6ff00', country: 'KR' },
  { id: 'halim', name: 'OMAR HALIM', short: 'HALIM', personality: 'defensive', carId: 'titan', paint: '#c9a227', country: 'EG' },
  { id: 'calloway', name: 'TESS CALLOWAY', short: 'CALLOWAY', personality: 'aggressive', carId: 'nova', paint: '#ff6a10', country: 'US' },
  { id: 'dias', name: 'BRUNO DIAS', short: 'DIAS', personality: 'technical', carId: 'vortex', paint: '#2f6dff', country: 'BR' },
];

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4];

export function creditsForPosition(pos: number, field: number, rewardMul: number): number {
  const base = [5000, 3500, 2600, 1900, 1400, 1100, 900, 700];
  const scale = 0.6 + 0.4 * (field / 8);
  return Math.round((base[Math.min(pos - 1, base.length - 1)] ?? 500) * scale * rewardMul);
}
