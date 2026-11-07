import { Track, TrackProjection } from '../src/track/Track';
import { getTrackDef } from '../src/track/TrackDefinitions';
const t = new Track(getTrackDef(process.argv[2] ?? 'skyline-2099'));
for (const b of t.branches) {
  const m = t.main;
  const open: number[] = [];
  for (let i = 0; i < m.count; i++) if (m.connR[i] === b.index || m.connL[i] === b.index) open.push(i);
  console.log(`branch ${b.id} side ${b.side} entryS ${b.entryS.toFixed(0)} exitS ${b.exitS.toFixed(0)} open main idx ${open[0]}..${open[open.length-1]} (${open.length}) s ${(open[0]*m.spacing).toFixed(0)}`);
  // walk along the main at the right edge +1m in the window, check projection onto branch
  const pr = new TrackProjection();
  for (let k = 0; k < open.length; k += 8) {
    const smp = m.samples[open[k]];
    const p = smp.pos.clone().addScaledVector(smp.right, b.side * (smp.width / 2 + 1));
    b.project(p, -1, pr);
    console.log(`  main s=${smp.s.toFixed(0)} -> branch s=${pr.s.toFixed(1)} lat=${pr.lateral.toFixed(2)} h=${pr.height.toFixed(2)} overrun=${pr.overrun.toFixed(2)} w=${pr.width}`);
  }
  const b0 = b.samples[0], b1 = b.samples[1];
  console.log(`  branch start pos ${b0.pos.toArray().map(v=>v.toFixed(1))} tangent ${b0.tangent.toArray().map(v=>v.toFixed(2))} next ${b1.pos.toArray().map(v=>v.toFixed(1))}`);
}
