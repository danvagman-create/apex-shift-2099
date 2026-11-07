// Dev tool: rasterize SVG files to PNG using the preinstalled Playwright Chromium.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { readFileSync } from 'node:fs';
const files = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
for (const f of files) {
  await page.setContent(`<html><body style="margin:0;background:#111">${readFileSync(f, 'utf8')}</body></html>`);
  const el = await page.$('svg');
  await el.screenshot({ path: f.replace(/\.svg$/, '.png') });
}
await browser.close();
