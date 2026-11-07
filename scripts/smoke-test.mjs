// End-to-end smoke test: boots the built game in headless Chromium, walks the menus,
// starts a race, drives with keyboard input and checks for runtime errors.
// Usage: npm run build && npm run smoke   (optional: BASE_URL=http://localhost:5173 to test dev server)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = 'screenshots/smoke';
mkdirSync(OUT, { recursive: true });
const quality = process.env.QUALITY ?? 'low';
let server = null;
let base = process.env.BASE_URL;
if (!base) {
  server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: 'pipe' });
  base = 'http://localhost:4174';
  await new Promise((r) => setTimeout(r, 2500));
}
const track = process.env.TRACK ?? 'neon-tokyo';
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.jpg`, quality: 80, timeout: 120000 }).catch((e) => console.log('screenshot failed', name, e.message)); console.log('captured', name); };
let ok = true;
try {
  await page.goto(`${base}/?quality=${quality}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(1500);
  await shot('01-title');
  await page.mouse.click(640, 360);
  await page.waitForSelector('.main-menu');
  await page.waitForTimeout(1200);
  await shot('02-main-menu');
  await page.click('[data-action="garage"]');
  await page.waitForSelector('.garage-list');
  await page.waitForTimeout(1500);
  await shot('03-garage');
  await page.click('[data-action="back"]');
  await page.waitForSelector('.main-menu');
  await page.click('[data-action="play"]');
  await page.waitForSelector('.track-cards');
  await page.click(`[data-action="track"][data-v="${track}"]`);
  await page.click('[data-action="laps"][data-v="1"]');
  await page.waitForTimeout(800);
  await shot('04-setup');
  await page.click('[data-action="start"]');
  await page.waitForFunction(() => window.__game && window.__game.state === 'race', null, { timeout: 240000 });
  console.log('race loaded');
  await page.waitForTimeout(2500);
  await shot('05-countdown');
  await page.waitForFunction(() => window.__game.race && window.__game.race.phase === 'race', null, { timeout: 120000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(6000);
  await shot('06-driving');
  await page.keyboard.down('Space');
  await page.waitForTimeout(1500);
  await shot('07-nitro');
  await page.keyboard.up('Space');
  await page.keyboard.press('ShiftLeft');
  await page.waitForTimeout(2500);
  await shot('08-hover');
  const state = await page.evaluate(() => {
    const r = window.__game.race;
    const p = r.session.player.physics;
    return { speed: p.speedKmh, transform: p.transform, progress: r.session.player.progress, pos: r.session.player.position, phase: r.phase };
  });
  console.log('player state', JSON.stringify(state));
  if (state.progress < 5 && state.speed < 20) { ok = false; console.log('FAIL: player did not move'); }
  if (state.transform < 0.9) { ok = false; console.log('FAIL: transform to hover did not complete'); }
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.overlay');
  await shot('09-pause');
  await page.click('[data-action="quit"]');
  await page.waitForSelector('.main-menu');
  console.log('returned to menu');
} catch (e) {
  ok = false;
  console.log('FAIL:', e.message);
  await shot('99-failure');
}
await browser.close();
server?.kill();
const relevant = errors.filter((e) => !/favicon|DevTools/.test(e));
if (relevant.length) { console.log('Console errors:\n' + relevant.slice(0, 20).join('\n')); ok = false; }
console.log(ok ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED');
process.exit(ok ? 0 : 1);
