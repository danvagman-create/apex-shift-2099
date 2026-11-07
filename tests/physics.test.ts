import { describe, it, expect } from 'vitest';
import { Track } from '../src/track/Track';
import { VehiclePhysics, emptyInput, resolveCarCollisions } from '../src/vehicles/VehiclePhysics';
import { VEHICLES, getVehicle } from '../src/vehicles/VehicleSpecs';
import { applyUpgrades, emptyUpgrades } from '../src/vehicles/Upgrades';
import type { TrackDef } from '../src/track/Track';

const STRAIGHT: TrackDef = {
  id: 'test', name: 'TEST', subtitle: '', description: '', theme: 'skyline', laps: 1, baseHeight: 0, defaultWidth: 24, wallHeight: 1, bankK: 0, maxBank: 0,
  timeTrialTargets: [1, 2, 3],
  cmds: [{ len: 9000 }, { turn: 180, radius: 300 }, { len: 9000 }, { turn: 180, radius: 300 }],
  branches: [],
};

function drive(carId: string, seconds: number, input = { ...emptyInput(), throttle: 1 }, hover = false) {
  const t = new Track(STRAIGHT);
  const p = new VehiclePhysics(getVehicle(carId).physics, t);
  p.placeAt(10, 0);
  p.setHoverImmediate(hover);
  const dt = 1 / 120;
  for (let i = 0; i < seconds / dt; i++) {
    p.beginFrame();
    p.step(dt, input);
  }
  return p;
}

describe('vehicle physics', () => {
  it('accelerates 0-100 km/h in under 3.5 s for every car', () => {
    for (const v of VEHICLES) {
      const p = drive(v.id, 3.5);
      expect(p.speedKmh).toBeGreaterThan(100);
    }
  });

  it('reaches near its road top speed and not beyond (no nitro)', () => {
    const p = drive('spectre', 45);
    const top = getVehicle('spectre').physics.maxSpeed * 3.6;
    expect(p.speedKmh).toBeGreaterThan(top * 0.9);
    expect(p.speedKmh).toBeLessThan(top * 1.03);
  });

  it('hover mode has a higher top speed than road mode', () => {
    const road = drive('phantom', 45);
    const hover = drive('phantom', 45, { ...emptyInput(), throttle: 1 }, true);
    expect(hover.speedKmh).toBeGreaterThan(road.speedKmh + 30);
  });

  it('nitro increases speed beyond the normal cap', () => {
    const normal = drive('titan', 6);
    const boosted = drive('titan', 6, { ...emptyInput(), throttle: 1, nitro: true });
    expect(boosted.speedKmh).toBeGreaterThan(normal.speedKmh + 15);
  });

  it('brakes from 300 km/h to a stop within a reasonable distance', () => {
    const t = new Track(STRAIGHT);
    const p = new VehiclePhysics(getVehicle('raptor').physics, t);
    p.placeAt(10, 0, 0, 300 / 3.6);
    p.frozen = false;
    const start = p.pos.clone();
    const inp = { ...emptyInput(), brake: 1 };
    for (let i = 0; i < 1200 && p.speed > 0.5; i++) {
      p.beginFrame();
      p.step(1 / 120, inp);
    }
    const d = p.pos.distanceTo(start);
    expect(d).toBeLessThan(170);
    expect(d).toBeGreaterThan(60);
  });

  it('walls keep the car on the road when steering hard', () => {
    const p = drive('vortex', 8, { ...emptyInput(), throttle: 1, steer: 1 });
    expect(Math.abs(p.proj.lateral)).toBeLessThan(13);
    expect(p.fallen).toBe(false);
  });

  it('transformation takes about transformTime seconds', () => {
    const t = new Track(STRAIGHT);
    const p = new VehiclePhysics(getVehicle('nova').physics, t);
    p.placeAt(10, 0);
    p.beginFrame();
    p.step(1 / 120, { ...emptyInput(), transform: true });
    let time = 1 / 120;
    while (p.transform < 1 && time < 3) {
      p.beginFrame();
      p.step(1 / 120, emptyInput());
      time += 1 / 120;
    }
    expect(time).toBeLessThan(getVehicle('nova').physics.transformTime + 0.1);
    expect(p.rideOffset).toBeGreaterThan(0.5);
  });

  it('car-to-car collisions separate overlapping cars', () => {
    const t = new Track(STRAIGHT);
    const a = new VehiclePhysics(getVehicle('vortex').physics, t);
    const b = new VehiclePhysics(getVehicle('titan').physics, t);
    a.placeAt(100, 0);
    b.placeAt(100.5, 0.8);
    resolveCarCollisions([a, b]);
    expect(a.pos.distanceTo(b.pos)).toBeGreaterThan(1.5);
  });

  it('upgrades improve stats', () => {
    const base = getVehicle('vortex').physics;
    const up = applyUpgrades(base, { engine: 3, nitro: 3, handling: 3, hover: 3 });
    expect(up.maxSpeed).toBeGreaterThan(base.maxSpeed);
    expect(up.grip).toBeGreaterThan(base.grip);
    expect(up.transformTime).toBeLessThan(base.transformTime);
    expect(applyUpgrades(base, emptyUpgrades())).toEqual(base);
  });
});
