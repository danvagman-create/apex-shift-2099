// Dev tool: capture frames of the running dev/preview server.
// Usage: node scripts/shot.mjs <url> <out.jpg> [waitMs] [width] [height]
// Pages may expose window.__capture() returning a data URL (rendered synchronously),
// which works reliably with the software GL used in headless CI.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, out, wait = '1000', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.setDefaultTimeout(240000);
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000, polling: 500 }); } catch { logs.push('timeout waiting for __ready'); }
await page.waitForTimeout(+wait);
const data = await page.evaluate(() => (window.__capture ? window.__capture() : null));
if (data) writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
else await page.screenshot({ path: out });
console.log(logs.slice(0, 25).join('\n') || 'no console errors');
await browser.close();
