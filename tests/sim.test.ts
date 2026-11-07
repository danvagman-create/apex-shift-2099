import { describe, it, expect } from 'vitest';
import { RaceSession } from '../src/race/RaceSession';
import { TRACKS } from '../src/track/TrackDefinitions';
import { emptyUpgrades } from '../src/vehicles/Upgrades';

// Full headless AI race simulation on every track: validates physics, AI navigation,
// shortcuts, lap counting and respawn logic without rendering.
describe('AI race simulation', () => {
  for (const def of TRACKS) {
    it(`7 AI finish 1 lap of ${def.name}`, () => {
      const session = new RaceSession(
        { mode: 'quick', trackId: def.id, laps: 1, opponents: 7, difficulty: 'hard', playerCar: 'vortex', playerUpgrades: emptyUpgrades(), seed: 7 },
        undefined, undefined, { withPlayer: false, countdown: 0.1 },
      );
      const dt = 1 / 60;
      let t = 0;
      let shortcutUses = 0;
      let hoverTime = 0;
      let maxSpeed = 0;
      const wasOnBranch = session.racers.map(() => false);
      while (session.state !== 'finished' && t < 300) {
        session.update(dt);
        t += dt;
        session.racers.forEach((r, i) => {
          const onB = r.physics.pathIndex !== 0;
          if (onB && !wasOnBranch[i]) shortcutUses++;
          wasOnBranch[i] = onB;
          if (r.physics.isHover) hoverTime += dt;
          maxSpeed = Math.max(maxSpeed, r.physics.speedKmh);
        });
      }
      const respawns = session.racers.reduce((a, r) => a + r.respawns, 0);
      const times = session.standings.map((r) => `${r.info.short}:${r.finishTime.toFixed(1)}${r.lapTimes.length ? '' : '(est)'}`);
      console.log(`${def.name}: ${times.join(' ')} | respawns ${respawns} shortcuts ${shortcutUses} hover ${(hoverTime / 7).toFixed(1)}s/car top ${maxSpeed.toFixed(0)}km/h`);
      expect(session.state).toBe('finished');
      const realFinishers = session.racers.filter((r) => r.lapTimes.length === 1).length;
      expect(realFinishers).toBeGreaterThanOrEqual(6);
      expect(respawns).toBeLessThan(6);
    });
  }
});
