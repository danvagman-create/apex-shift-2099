import type { ChampionshipProgress, SaveData, StandingEntry } from '../core/SaveManager';
import type { Difficulty } from './AIDriver';
import { POINTS, RIVALS } from './RaceConfig';

export interface CupDef {
  id: string;
  name: string;
  desc: string;
  difficulty: Difficulty;
  opponents: number;
  races: { trackId: string; laps: number }[];
  reward: number;
  unlockCar?: string;
  unlocksCup?: string;
}

export const CUPS: CupDef[] = [
  {
    id: 'rookie',
    name: 'ROOKIE CIRCUIT',
    desc: 'Three-round introduction to the world tour. Forgiving rivals, short races.',
    difficulty: 'easy',
    opponents: 5,
    races: [
      { trackId: 'neon-tokyo', laps: 2 },
      { trackId: 'redline-canyon', laps: 1 },
      { trackId: 'skyline-2099', laps: 2 },
    ],
    reward: 8000,
    unlockCar: 'nova',
    unlocksCup: 'pro',
  },
  {
    id: 'pro',
    name: 'PRO SERIES',
    desc: 'A full grid of seven professionals. Expect overtakes, blocking and hover shortcuts.',
    difficulty: 'normal',
    opponents: 7,
    races: [
      { trackId: 'skyline-2099', laps: 2 },
      { trackId: 'neon-tokyo', laps: 3 },
      { trackId: 'redline-canyon', laps: 2 },
    ],
    reward: 15000,
    unlockCar: 'titan',
    unlocksCup: 'apex',
  },
  {
    id: 'apex',
    name: 'APEX LEGENDS',
    desc: 'The elite. Ruthless AI at full skill with maxed machinery. Win this and the PHANTOM ZERO is yours.',
    difficulty: 'apex',
    opponents: 7,
    races: [
      { trackId: 'redline-canyon', laps: 2 },
      { trackId: 'skyline-2099', laps: 3 },
      { trackId: 'neon-tokyo', laps: 3 },
    ],
    reward: 30000,
    unlockCar: 'phantom',
  },
];

export function getCup(id: string): CupDef {
  return CUPS.find((c) => c.id === id) ?? CUPS[0];
}

/** Begin (or restart) a cup; entrants are the player + a fixed set of rivals. */
export function startCup(save: SaveData, cupId: string, playerCar: string): ChampionshipProgress {
  const cup = getCup(cupId);
  const standings: StandingEntry[] = [{ id: 'player', name: 'YOU', carId: playerCar, points: 0, isPlayer: true }];
  for (const r of RIVALS.slice(0, cup.opponents)) standings.push({ id: r.id, name: r.name, carId: r.carId, points: 0, isPlayer: false, personality: r.personality });
  const prog: ChampionshipProgress = { cupId, raceIndex: 0, standings, results: [] };
  save.activeChampionship = prog;
  return prog;
}

/** Apply finishing order (array of racer ids, winner first). Returns points awarded per id. */
export function applyRaceResult(prog: ChampionshipProgress, trackId: string, order: string[]): Record<string, number> {
  const awarded: Record<string, number> = {};
  order.forEach((id, i) => {
    const pts = POINTS[i] ?? 0;
    awarded[id] = pts;
    const e = prog.standings.find((s) => s.id === id);
    if (e) e.points += pts;
  });
  prog.results.push({ trackId, order });
  prog.raceIndex++;
  prog.standings.sort((a, b) => b.points - a.points);
  return awarded;
}

export function isCupComplete(prog: ChampionshipProgress): boolean {
  return prog.raceIndex >= getCup(prog.cupId).races.length;
}

export function playerCupPosition(prog: ChampionshipProgress): number {
  const sorted = [...prog.standings].sort((a, b) => b.points - a.points);
  return sorted.findIndex((s) => s.isPlayer) + 1;
}

/** Rewards & unlocks at the end of a cup. */
export function finishCup(save: SaveData, prog: ChampionshipProgress): { position: number; credits: number; unlockedCar?: string; unlockedCup?: string } {
  const cup = getCup(prog.cupId);
  const position = playerCupPosition(prog);
  const credits = Math.round(cup.reward * (position === 1 ? 1 : position === 2 ? 0.55 : position === 3 ? 0.35 : 0.12));
  save.credits += credits;
  const prevBest = save.cupResults[cup.id];
  if (prevBest === undefined || position < prevBest) save.cupResults[cup.id] = position;
  let unlockedCar: string | undefined;
  let unlockedCup: string | undefined;
  if (position <= 3 && cup.unlocksCup && !save.cupsUnlocked.includes(cup.unlocksCup)) {
    save.cupsUnlocked.push(cup.unlocksCup);
    unlockedCup = cup.unlocksCup;
  }
  if (position === 1 && cup.unlockCar && !save.unlockedCars.includes(cup.unlockCar)) {
    save.unlockedCars.push(cup.unlockCar);
    unlockedCar = cup.unlockCar;
  }
  save.activeChampionship = null;
  return { position, credits, unlockedCar, unlockedCup };
}
