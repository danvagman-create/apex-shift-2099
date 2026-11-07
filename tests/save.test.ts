import { describe, it, expect } from 'vitest';
import { SaveManager, MemoryStorage, migrateSave, createDefaultSave } from '../src/core/SaveManager';
import { startCup, applyRaceResult, isCupComplete, finishCup, getCup } from '../src/race/Championship';
import { GhostRecorder, GhostPlayer, encodeFloats, decodeFloats } from '../src/race/Ghost';
import { Quaternion, Vector3 } from 'three';

describe('save data', () => {
  it('creates defaults and persists changes', () => {
    const st = new MemoryStorage();
    const s = new SaveManager(st);
    expect(s.data.unlockedCars.length).toBe(3);
    s.addCredits(10000);
    s.save();
    const s2 = new SaveManager(st);
    expect(s2.data.credits).toBe(15000);
  });

  it('buys cars and upgrades with credit checks', () => {
    const s = new SaveManager(new MemoryStorage());
    expect(s.buyCar('nova')).toBe(false); // not enough credits (5000 < 12000)
    s.addCredits(20000);
    expect(s.buyCar('nova')).toBe(true);
    expect(s.isUnlocked('nova')).toBe(true);
    const before = s.data.credits;
    expect(s.buyUpgrade('nova', 'engine')).toBe(true);
    expect(s.data.credits).toBe(before - 2000);
    expect(s.customization('nova').upgrades.engine).toBe(1);
    expect(s.buyUpgrade('titan', 'engine')).toBe(false); // locked car
  });

  it('migrates partial / corrupt saves safely', () => {
    const m = migrateSave({ credits: 'lots', unlockedCars: ['vortex', 'bogus'], settings: { quality: 'low' } });
    expect(m.credits).toBe(createDefaultSave().credits);
    expect(m.unlockedCars).not.toContain('bogus');
    expect(m.settings.quality).toBe('low');
    expect(m.settings.masterVolume).toBeGreaterThan(0);
    expect(migrateSave(null).version).toBe(1);
  });

  it('records best laps', () => {
    const s = new SaveManager(new MemoryStorage());
    expect(s.submitLap('neon-tokyo', 70, 'vortex')).toBe(true);
    expect(s.submitLap('neon-tokyo', 72, 'vortex')).toBe(false);
    expect(s.submitLap('neon-tokyo', 69, 'raptor')).toBe(true);
    expect(s.record('neon-tokyo').bestLapCar).toBe('raptor');
  });
});

describe('championship', () => {
  it('awards points, completes, pays out and unlocks', () => {
    const save = createDefaultSave();
    const prog = startCup(save, 'rookie', 'vortex');
    const cup = getCup('rookie');
    expect(prog.standings.length).toBe(cup.opponents + 1);
    for (let i = 0; i < cup.races.length; i++) {
      const order = ['player', ...prog.standings.filter((s) => !s.isPlayer).map((s) => s.id)];
      applyRaceResult(prog, cup.races[i].trackId, order);
    }
    expect(isCupComplete(prog)).toBe(true);
    expect(prog.standings[0].id).toBe('player');
    expect(prog.standings[0].points).toBe(75);
    const credits = save.credits;
    const res = finishCup(save, prog);
    expect(res.position).toBe(1);
    expect(save.credits).toBe(credits + cup.reward);
    expect(save.unlockedCars).toContain('nova');
    expect(save.cupsUnlocked).toContain('pro');
    expect(save.activeChampionship).toBeNull();
  });
});

describe('ghost', () => {
  it('encodes and decodes float arrays losslessly', () => {
    const a = new Float32Array([1.5, -2.25, 1e6, 0.1]);
    expect(Array.from(decodeFloats(encodeFloats(a)))).toEqual(Array.from(a));
  });
  it('records and replays positions', () => {
    const rec = new GhostRecorder();
    const q = new Quaternion();
    for (let i = 0; i < 200; i++) rec.record(1 / 60, new Vector3(i, 0, 0), q, 0, i * 2);
    const g = new GhostPlayer(rec.serialize());
    const p = new Vector3();
    const s = g.sample(1, p, new Quaternion());
    expect(s).not.toBeNull();
    expect(p.x).toBeGreaterThan(50);
    expect(p.x).toBeLessThan(70);
    const t = g.timeAtProgress(120);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(0.9);
    expect(t!).toBeLessThan(1.1);
  });
});
