// Dev tool: analyses track layouts and writes an SVG preview per track.
// Run: npm run track-report
import { writeFileSync, mkdirSync } from 'node:fs';
import { Track } from '../src/track/Track';
import { TRACKS } from '../src/track/TrackDefinitions';

mkdirSync('screenshots', { recursive: true });
const RAW = process.env.RAW === '1';
for (const def0 of TRACKS) {
  const def = RAW ? { ...def0, closeWith: undefined } : def0;
  const t = new Track(def);
  const m = t.main;
  let minR = Infinity;
  let maxBank = 0;
  let maxSlope = 0;
  let minY = Infinity, maxY = -Infinity;
  for (const s of m.samples) {
    if (Math.abs(s.curvature) > 1e-5) minR = Math.min(minR, 1 / Math.abs(s.curvature));
    maxBank = Math.max(maxBank, Math.abs(s.bank));
    maxSlope = Math.max(maxSlope, Math.abs(s.tangent.y));
    minY = Math.min(minY, s.pos.y); maxY = Math.max(maxY, s.pos.y);
  }
  // self intersection check
  const issues: string[] = [];
  const n = m.count;
  for (let i = 0; i < n; i += 3) {
    for (let j = i + 60; j < n; j += 3) {
      const ds = Math.min(Math.abs(m.samples[i].s - m.samples[j].s), m.length - Math.abs(m.samples[i].s - m.samples[j].s));
      if (ds < 150) continue;
      const a = m.samples[i].pos, b = m.samples[j].pos;
      const dxz = Math.hypot(a.x - b.x, a.z - b.z);
      const dy = Math.abs(a.y - b.y);
      const need = (m.samples[i].width + m.samples[j].width) / 2 + 14;
      if (dxz < need && dy < 9) issues.push(`s=${a && m.samples[i].s.toFixed(0)} vs s=${m.samples[j].s.toFixed(0)} dist=${dxz.toFixed(1)} dy=${dy.toFixed(1)}`);
    }
  }
  const cmdLens = t.cmds.map((c, i) => (c.len !== undefined && !c.turn ? `${i}:${c.len.toFixed(0)}` : '')).filter(Boolean).join(' ');
  console.log(`\n== ${def.name}: length ${m.length.toFixed(0)}m, samples ${n}, minR ${minR.toFixed(0)}m, maxBank ${(maxBank * 57.3).toFixed(1)}deg, maxSlope ${(maxSlope * 100).toFixed(1)}%, y ${minY.toFixed(0)}..${maxY.toFixed(0)}`);
  console.log(`   closure ${t.layout.closureError.toFixed(2)}m heading err ${t.layout.headingError.toFixed(2)}deg; straights: ${cmdLens}`);
  for (const b of t.branches) {
    const openMain = [...m.wallL, ...m.wallR].filter((w) => w === 0).length;
    const openB = [...b.wallL, ...b.wallR].filter((w) => w === 0).length;
    let span = b.exitS - b.entryS; if (span < 0) span += m.length;
    console.log(`   branch ${b.id}: len ${b.length.toFixed(0)}m vs main span ${span.toFixed(0)}m; open main samples ${openMain}, open branch samples ${openB}`);
  }
  console.log(issues.length ? `   SELF-INTERSECTIONS (${issues.length}): ${issues.slice(0, 6).join(' | ')}` : '   no self-intersections');
  // SVG
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of t.paths) for (const s of p.samples) { minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x); minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z); }
  const pad = 60, W = maxX - minX + pad * 2, H = maxZ - minZ + pad * 2;
  const tx = (x: number) => (maxX - x + pad).toFixed(1), tz = (z: number) => (maxZ - z + pad).toFixed(1);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="1000" height="${(1000 * H / W).toFixed(0)}" style="background:#111">`;
  for (const p of t.paths) {
    const pts = p.samples.map((s) => `${tx(s.pos.x)},${tz(s.pos.z)}`).join(' ');
    const w = p.samples[0].width;
    svg += `<polyline points="${pts}" fill="none" stroke="${p.index === 0 ? '#555' : '#0ff6'}" stroke-width="${w}" ${p.closed ? '' : ''}/>`;
    svg += `<polyline points="${pts}${p.closed ? ' ' + tx(p.samples[0].pos.x) + ',' + tz(p.samples[0].pos.z) : ''}" fill="none" stroke="${p.index === 0 ? '#fff' : '#0ff'}" stroke-width="2"/>`;
    // walls open
    for (let i = 0; i < p.count; i++) {
      const s = p.samples[i];
      if (!p.wallL[i]) { const e = s.pos.clone().addScaledVector(s.right, -s.width / 2); svg += `<circle cx="${tx(e.x)}" cy="${tz(e.z)}" r="2" fill="#f0f"/>`; }
      if (!p.wallR[i]) { const e = s.pos.clone().addScaledVector(s.right, s.width / 2); svg += `<circle cx="${tx(e.x)}" cy="${tz(e.z)}" r="2" fill="#ff0"/>`; }
      if (s.flags & 1 && i % 5 === 0) svg += `<circle cx="${tx(s.pos.x)}" cy="${tz(s.pos.z)}" r="5" fill="#f80"/>`;
      if (!isNaN(s.hoverLane) && i % 4 === 0) { const e = s.pos.clone().addScaledVector(s.right, s.hoverLane); svg += `<circle cx="${tx(e.x)}" cy="${tz(e.z)}" r="2.5" fill="#0f8"/>`; }
    }
  }
  const s0 = m.samples[0];
  svg += `<circle cx="${tx(s0.pos.x)}" cy="${tz(s0.pos.z)}" r="12" fill="#f00"/>`;
  for (let k = 1; k < 8; k++) { const sm = m.samples[m.indexAt(t.gridSlot(k).s)]; svg += `<circle cx="${tx(sm.pos.x)}" cy="${tz(sm.pos.z)}" r="4" fill="#0f0"/>`; }
  svg += `<text x="20" y="40" fill="#fff" font-size="36" font-family="sans-serif">${def.name} ${m.length.toFixed(0)}m</text></svg>`;
  writeFileSync(`screenshots/track-${def.id}.svg`, svg);
}
