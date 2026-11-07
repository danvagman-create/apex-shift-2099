// Dev tool: start a race at a given track position and capture the canvas after N seconds.
// Usage: node scripts/race-shot.mjs <trackId> <s> <out.jpg> [quality] [frames] [extra query]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [track, at, out, quality = 'medium', frames = '40', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(e.message));
await page.goto(`http://localhost:5173/?quality=${quality}&race=${track}&at=${at}${extra}`);
await page.waitForFunction(() => window.__game && window.__game.state === 'race', null, { polling: 500 });
// hold throttle and let N frames run
await page.keyboard.down('KeyW');
for (const k of (process.env.KEYS ?? '').split(',').filter(Boolean)) await page.keyboard.down(k);
const start = await page.evaluate(() => window.__game.race.frameCount ?? 0);
await page.waitForFunction((n) => (window.__game.race.frameCount ?? 0) >= n, +start + +frames, { polling: 500 });
const info = await page.evaluate(() => { const r = window.__game.race; const p = r.session.player.physics; return { kmh: p.speedKmh.toFixed(0), s: p.proj.s.toFixed(0), stats: window.__game.ctx.stats() }; });
const data = await page.evaluate(() => window.__capture());
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log(JSON.stringify(info), logs.slice(0, 5).join(' | ') || 'no errors');
await browser.close();
