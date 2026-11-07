import { RaceSession } from '../src/race/RaceSession';
import { emptyUpgrades } from '../src/vehicles/Upgrades';
const trackId = process.argv[2] ?? 'redline-canyon';
const s = new RaceSession({ mode: 'quick', trackId, laps: 1, opponents: 7, difficulty: 'hard', playerCar: 'vortex', playerUpgrades: emptyUpgrades(), seed: 7 }, undefined, undefined, { withPlayer: false, countdown: 0.1 });
const st = s.racers.map(() => ({ walls: 0, wallImpulse: 0, transforms: 0, hover: 0, nitro: 0, slowCorner: 0, carHits: 0, drift: 0 }));
const dt = 1 / 60; let t = 0;
while (s.state !== 'finished' && t < 200) {
  s.update(dt); t += dt;
  s.racers.forEach((r, i) => {
    const p = r.physics, e = p.events, x = st[i];
    if (r.finished) return;
    if (e.wallHit > 1) { x.walls++; x.wallImpulse += e.wallHit; }
    if (e.carHit > 1) x.carHits++;
    if (e.transformStart) x.transforms++;
    if (p.isHover) x.hover += dt;
    if (p.nitroActive) x.nitro += dt;
    if (p.drifting) x.drift += dt;
  });
}
s.standings.forEach((r) => { const x = st[r.index]; console.log(`${r.info.short.padEnd(9)} ${r.info.carId.padEnd(8)} ${r.ai!.personality.padEnd(10)} t=${r.finishTime.toFixed(1)} walls=${x.walls} (${x.wallImpulse.toFixed(0)}) carHits=${x.carHits} transforms=${x.transforms} hover=${x.hover.toFixed(1)} nitro=${x.nitro.toFixed(1)} drift=${x.drift.toFixed(1)}`); });
