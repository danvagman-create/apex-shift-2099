import { RaceSession } from '../src/race/RaceSession';
import { emptyUpgrades } from '../src/vehicles/Upgrades';
const trackId = process.argv[2] ?? 'skyline-2099';
const session = new RaceSession({ mode: 'quick', trackId, laps: 1, opponents: 7, difficulty: 'hard', playerCar: 'vortex', playerUpgrades: emptyUpgrades(), seed: 7 }, undefined, undefined, { withPlayer: false, countdown: 0.1 });
const dt = 1 / 60; let t = 0;
const prevFallen = session.racers.map(() => false);
const prevPath = session.racers.map(() => 0);
while (session.state !== 'finished' && t < 200) {
  session.update(dt); t += dt;
  if (Math.abs(t % 5) < dt) for (const r of session.racers) if (["HALIM","DIAS"].includes(r.info.short)) { const p = r.physics; console.log(`  t=${t.toFixed(0)} ${r.info.short} s=${p.proj.s.toFixed(0)} lat=${p.proj.lateral.toFixed(1)} v=${p.speedKmh.toFixed(0)} hov=${p.transform.toFixed(1)} fw=${p.forward.dot(p.proj.tangent).toFixed(2)} thr=${r.input.throttle.toFixed(2)} br=${r.input.brake.toFixed(2)} st=${r.input.steer.toFixed(2)}`); }
  session.racers.forEach((r, i) => {
    const p = r.physics;
    if (p.pathIndex !== prevPath[i]) { console.log(`${t.toFixed(1)} ${r.info.short} path ${prevPath[i]}->${p.pathIndex} s=${p.proj.s.toFixed(0)} hover=${p.transform.toFixed(2)}`); prevPath[i] = p.pathIndex; }
    if (p.fallen && !prevFallen[i]) console.log(`${t.toFixed(1)} ${r.info.short} FELL path=${p.pathIndex} s=${p.proj.s.toFixed(0)} lat=${p.proj.lateral.toFixed(1)} w=${p.proj.width.toFixed(1)} h=${p.proj.height.toFixed(1)} v=${p.speedKmh.toFixed(0)} hover=${p.transform.toFixed(2)} grounded=${p.grounded} cmd=${session.track.main.samples[p.proj.index]?.cmd}`);
    prevFallen[i] = p.fallen;
  });
}
console.log(session.standings.map((r) => `${r.info.short}:${r.finishTime.toFixed(1)} prog=${r.progress.toFixed(0)}`).join(' '));
for (const r of session.racers) {
  const p = r.physics;
  console.log(`${r.info.short} path=${p.pathIndex} s=${p.proj.s.toFixed(0)} lat=${p.proj.lateral.toFixed(1)} w=${p.proj.width.toFixed(1)} v=${p.speedKmh.toFixed(0)} hover=${p.transform.toFixed(2)} grounded=${p.grounded} yawVsTrack=${p.forward.dot(p.proj.tangent).toFixed(2)} inp=${JSON.stringify(r.input)} cmd=${session.track.main.samples[p.proj.index]?.cmd} respawns=${r.respawns}`);
}
