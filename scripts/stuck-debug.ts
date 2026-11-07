import { RaceSession } from '../src/race/RaceSession';
import { emptyUpgrades } from '../src/vehicles/Upgrades';
const session = new RaceSession({ mode: 'quick', trackId: 'skyline-2099', laps: 1, opponents: 7, difficulty: 'hard', playerCar: 'vortex', playerUpgrades: emptyUpgrades(), seed: 7 }, undefined, undefined, { withPlayer: false, countdown: 0.1 });
const dt = 1 / 60; let t = 0;
while (t < 55) { session.update(dt); t += dt; }
const r = session.racers.find((x) => x.info.short === 'HALIM')!;
const p = r.physics;
const f = (v: any) => v.toArray().map((x: number) => x.toFixed(2)).join(',');
for (let k = 0; k < 6; k++) {
  const before = p.pos.clone();
  p.beginFrame();
  p.step(1 / 120, r.input);
  console.log(`pos ${f(before)} -> ${f(p.pos)} vel ${f(p.vel)} fwd ${f(p.forward)} s=${p.proj.s.toFixed(2)} idx=${p.proj.index} lat=${p.proj.lateral.toFixed(2)} h=${p.proj.height.toFixed(2)} wallHit=${p.events.wallHit.toFixed(1)} grounded=${p.grounded} sup=${p.supported}`);
}
const m = session.track.main;
for (let i = 1785; i <= 1797; i += 2) { const s = m.samples[i]; console.log(i, s.s.toFixed(0), f(s.pos), 'w', s.width, 'bank', s.bank.toFixed(3), 'vC', s.vCurv.toFixed(4), 'curv', s.curvature.toFixed(4), 'T', f(s.tangent)); }
