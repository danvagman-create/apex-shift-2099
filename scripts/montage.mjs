// Dev tool: combine images into a grid (uses Playwright Chromium canvas).
// Usage: node scripts/montage.mjs out.jpg cols img1 img2 ...
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [out, cols, ...files] = process.argv.slice(2);
const imgs = files.map((f) => `data:image/jpeg;base64,${readFileSync(f).toString('base64')}`);
const browser = await chromium.launch();
const page = await browser.newPage();
const data = await page.evaluate(async ({ imgs, cols }) => {
  const els = await Promise.all(imgs.map((src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; })));
  const w = els[0].width, h = els[0].height, c = +cols, rows = Math.ceil(els.length / c);
  const cv = document.createElement('canvas'); cv.width = w * c; cv.height = h * rows;
  const ctx = cv.getContext('2d');
  els.forEach((im, k) => ctx.drawImage(im, (k % c) * w, Math.floor(k / c) * h, w, h));
  return cv.toDataURL('image/jpeg', 0.9);
}, { imgs, cols });
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
await browser.close();
