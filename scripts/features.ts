import { Track } from '../src/track/Track';
import { TRACKS } from '../src/track/TrackDefinitions';
import { F_TUNNEL, F_BRIDGE, F_JUMP } from '../src/track/TrackLayout';
for (const d of TRACKS) {
  const t = new Track(d);
  const find = (f: number) => { const i = t.main.samples.findIndex((s) => s.flags & f); return i < 0 ? -1 : Math.round(t.main.samples[i].s); };
  console.log(d.id, 'tunnel', find(F_TUNNEL), 'bridge', find(F_BRIDGE), 'jump', find(F_JUMP), 'branches', t.branches.map((b) => Math.round(b.entryS)).join(','));
}
