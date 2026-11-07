import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { Track, TrackProjection } from '../src/track/Track';
import { TRACKS } from '../src/track/TrackDefinitions';
import { RacingLine } from '../src/track/RacingLine';
import { autoClose, runLayout } from '../src/track/TrackLayout';

describe('track layout', () => {
  it('autoClose produces an exactly closed loop', () => {
    const cmds = autoClose([{ len: 300 }, { turn: 90, radius: 100 }, { len: 200 }, { turn: 90, radius: 100 }, { len: 300 }, { turn: 90, radius: 100 }, { len: 200 }, { turn: 90, radius: 100 }], 0, 2);
    const res = runLayout(cmds, 0);
    expect(res.closureError).toBeLessThan(0.05);
  });

  for (const def of TRACKS) {
    describe(def.name, () => {
      const t = new Track(def);
      it('closes, has sensible length and positive auto-closed straights', () => {
        expect(t.layout.closureError).toBeLessThan(0.5);
        expect(t.length).toBeGreaterThan(3000);
        expect(t.length).toBeLessThan(8000);
        for (const c of t.cmds) if (c.len !== undefined && !c.turn) expect(c.len).toBeGreaterThan(50);
      });
      it('frames are orthonormal', () => {
        for (let i = 0; i < t.main.count; i += 37) {
          const s = t.main.samples[i];
          expect(Math.abs(s.tangent.length() - 1)).toBeLessThan(1e-3);
          expect(Math.abs(s.up.dot(s.tangent))).toBeLessThan(1e-3);
          expect(Math.abs(s.right.dot(s.up))).toBeLessThan(1e-3);
          expect(s.up.y).toBeGreaterThan(0.9);
        }
      });
      it('projection round-trips points on the surface', () => {
        const out = new TrackProjection();
        const p = new Vector3();
        for (let k = 0; k < 60; k++) {
          const s = (k / 60) * t.length;
          const lat = ((k % 7) - 3) * 2.5;
          t.main.pointAt(s, lat, 0.5, p);
          t.main.project(p, -1, out);
          let ds = Math.abs(out.s - s);
          ds = Math.min(ds, t.length - ds);
          expect(ds).toBeLessThan(0.6);
          expect(Math.abs(out.lateral - lat)).toBeLessThan(0.25);
          expect(Math.abs(out.height - 0.5)).toBeLessThan(0.25);
        }
      });
      it('branches connect to the main road with open walls at both ends', () => {
        for (const b of t.branches) {
          expect(b.hoverOnly).toBe(true);
          const span = (b.exitS - b.entryS + t.length) % t.length;
          expect(b.length).toBeLessThan(span); // a shortcut is shorter than the detour
          const open = [...t.main.wallL, ...t.main.wallR].filter((w) => w === 0).length;
          expect(open).toBeGreaterThan(20);
          // mainS mapping is monotonic and spans entry..exit
          expect(Math.abs(t.mainS(b.index, 0) - b.entryS)).toBeLessThan(1);
          expect(Math.abs(t.mainS(b.index, b.length) - b.exitS)).toBeLessThan(1);
        }
      });
      it('racing line stays inside the road and cuts corners', () => {
        const line = new RacingLine(t.main);
        let maxAbs = 0;
        for (let i = 0; i < t.main.count; i++) {
          expect(Math.abs(line.offset[i])).toBeLessThanOrEqual(t.main.samples[i].width / 2);
          maxAbs = Math.max(maxAbs, Math.abs(line.offset[i]));
        }
        expect(maxAbs).toBeGreaterThan(3); // it actually uses the width
        const prof = line.speedProfile(26, 13, 30, 110);
        const min = Math.min(...prof);
        expect(min).toBeGreaterThan(15);
        expect(Math.max(...prof)).toBeLessThanOrEqual(110);
      });
      it('grid slots are on the road behind the start line', () => {
        for (let i = 0; i < 8; i++) {
          const g = t.gridSlot(i);
          expect(g.s).toBeGreaterThan(t.length - 80);
          expect(Math.abs(g.lateral)).toBeLessThan(t.main.samples[t.main.indexAt(g.s)].width / 2 - 1);
        }
      });
    });
  }
});
