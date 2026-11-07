import { DEFAULT_SETTINGS, suggestPreset, type UserSettings } from './Settings';
import { VEHICLES, getVehicle, type PaintFinish } from '../vehicles/VehicleSpecs';
import { emptyUpgrades, upgradeCost, MAX_UPGRADE_LEVEL, type UpgradeKind, type UpgradeLevels } from '../vehicles/Upgrades';

export interface CarCustomization {
  paint: string;
  finish: PaintFinish;
  accent: string;
  light: string;
  rim: string;
  upgrades: UpgradeLevels;
}

export interface TrackRecord {
  bestLap?: number;
  bestLapCar?: string;
  bestRace?: number;
  bestRaceCar?: string;
  ghost?: string;
  ghostCar?: string;
  ghostLapTime?: number;
}

export interface StandingEntry {
  id: string;
  name: string;
  carId: string;
  points: number;
  isPlayer: boolean;
  personality?: string;
}

export interface ChampionshipProgress {
  cupId: string;
  raceIndex: number;
  standings: StandingEntry[];
  results: { trackId: string; order: string[] }[];
}

export interface QuickRacePrefs {
  trackId: string;
  opponents: number;
  difficulty: string;
  laps: number;
}

export interface SaveData {
  version: number;
  credits: number;
  unlockedCars: string[];
  selectedCar: string;
  cars: Record<string, CarCustomization>;
  records: Record<string, TrackRecord>;
  cupsUnlocked: string[];
  cupResults: Record<string, number>;
  activeChampionship: ChampionshipProgress | null;
  settings: UserSettings;
  quickRace: QuickRacePrefs;
  stats: { races: number; wins: number; podiums: number; distanceKm: number; topSpeedKmh: number };
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageAdapter {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const SAVE_KEY = 'apex-shift-2099/save';
export const SAVE_VERSION = 1;

export function defaultCustomization(carId: string): CarCustomization {
  const v = getVehicle(carId);
  return {
    paint: v.colors.paint,
    finish: 'metallic',
    accent: v.colors.accent,
    light: v.colors.light,
    rim: v.colors.rim,
    upgrades: emptyUpgrades(),
  };
}

export function createDefaultSave(): SaveData {
  const cars: Record<string, CarCustomization> = {};
  for (const v of VEHICLES) cars[v.id] = defaultCustomization(v.id);
  return {
    version: SAVE_VERSION,
    credits: 5000,
    unlockedCars: VEHICLES.filter((v) => v.unlockedByDefault).map((v) => v.id),
    selectedCar: VEHICLES[0].id,
    cars,
    records: {},
    cupsUnlocked: ['rookie'],
    cupResults: {},
    activeChampionship: null,
    settings: { ...DEFAULT_SETTINGS, quality: suggestPreset() },
    quickRace: { trackId: 'neon-tokyo', opponents: 7, difficulty: 'normal', laps: 3 },
    stats: { races: 0, wins: 0, podiums: 0, distanceKm: 0, topSpeedKmh: 0 },
  };
}

/** Merge loaded data over defaults so new fields added in later versions get sensible values. */
export function migrateSave(raw: unknown): SaveData {
  const def = createDefaultSave();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Partial<SaveData>;
  const out: SaveData = {
    ...def,
    ...r,
    version: SAVE_VERSION,
    settings: { ...def.settings, ...(r.settings ?? {}) },
    quickRace: { ...def.quickRace, ...(r.quickRace ?? {}) },
    stats: { ...def.stats, ...(r.stats ?? {}) },
    cars: { ...def.cars },
    records: { ...(r.records ?? {}) },
    cupResults: { ...(r.cupResults ?? {}) },
  };
  for (const v of VEHICLES) {
    const c = r.cars?.[v.id];
    if (c) out.cars[v.id] = { ...defaultCustomization(v.id), ...c, upgrades: { ...emptyUpgrades(), ...(c.upgrades ?? {}) } };
  }
  out.unlockedCars = Array.from(new Set([...(def.unlockedCars), ...(Array.isArray(r.unlockedCars) ? r.unlockedCars : [])])).filter((id) =>
    VEHICLES.some((v) => v.id === id),
  );
  if (!out.unlockedCars.includes(out.selectedCar)) out.selectedCar = out.unlockedCars[0];
  if (!Array.isArray(out.cupsUnlocked) || out.cupsUnlocked.length === 0) out.cupsUnlocked = ['rookie'];
  if (typeof out.credits !== 'number' || !isFinite(out.credits)) out.credits = def.credits;
  return out;
}

export class SaveManager {
  data: SaveData;
  private listeners = new Set<(d: SaveData) => void>();
  constructor(private storage: StorageAdapter) {
    this.data = this.load();
  }

  static createBrowser(): SaveManager {
    let storage: StorageAdapter;
    try {
      const ls = window.localStorage;
      const probe = '__apex_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      storage = ls;
    } catch {
      storage = new MemoryStorage();
    }
    return new SaveManager(storage);
  }

  private load(): SaveData {
    try {
      const txt = this.storage.getItem(SAVE_KEY);
      if (!txt) return createDefaultSave();
      return migrateSave(JSON.parse(txt));
    } catch {
      return createDefaultSave();
    }
  }

  save(): void {
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch (e) {
      // Quota exceeded: drop ghosts (largest payload) and retry once.
      for (const rec of Object.values(this.data.records)) delete rec.ghost;
      try {
        this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
      } catch {
        console.warn('Save failed', e);
      }
    }
    for (const l of this.listeners) l(this.data);
  }

  onChange(fn: (d: SaveData) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset(): void {
    this.data = createDefaultSave();
    this.save();
  }

  customization(carId: string): CarCustomization {
    if (!this.data.cars[carId]) this.data.cars[carId] = defaultCustomization(carId);
    return this.data.cars[carId];
  }

  isUnlocked(carId: string): boolean {
    return this.data.unlockedCars.includes(carId);
  }

  buyCar(carId: string): boolean {
    const v = getVehicle(carId);
    if (this.isUnlocked(carId) || this.data.credits < v.price) return false;
    this.data.credits -= v.price;
    this.data.unlockedCars.push(carId);
    this.save();
    return true;
  }

  unlockCar(carId: string): boolean {
    if (this.isUnlocked(carId)) return false;
    this.data.unlockedCars.push(carId);
    this.save();
    return true;
  }

  buyUpgrade(carId: string, kind: UpgradeKind): boolean {
    const c = this.customization(carId);
    const lvl = c.upgrades[kind];
    const cost = upgradeCost(lvl);
    if (cost === null || lvl >= MAX_UPGRADE_LEVEL || this.data.credits < cost || !this.isUnlocked(carId)) return false;
    this.data.credits -= cost;
    c.upgrades[kind] = lvl + 1;
    this.save();
    return true;
  }

  addCredits(n: number): void {
    this.data.credits = Math.max(0, Math.round(this.data.credits + n));
    this.save();
  }

  record(trackId: string): TrackRecord {
    if (!this.data.records[trackId]) this.data.records[trackId] = {};
    return this.data.records[trackId];
  }

  /** Returns true if this was a new best lap. */
  submitLap(trackId: string, time: number, carId: string): boolean {
    const r = this.record(trackId);
    if (r.bestLap === undefined || time < r.bestLap) {
      r.bestLap = time;
      r.bestLapCar = carId;
      return true;
    }
    return false;
  }

  submitRace(trackId: string, time: number, carId: string): boolean {
    const r = this.record(trackId);
    if (r.bestRace === undefined || time < r.bestRace) {
      r.bestRace = time;
      r.bestRaceCar = carId;
      return true;
    }
    return false;
  }
}
