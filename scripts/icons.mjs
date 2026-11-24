#!/usr/bin/env node
/** Gera os PNGs do PWA a partir de public/icons/icon.svg. Uso: node scripts/icons.mjs */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, pad] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  // maskable: conteúdo dentro da zona segura (80%)
  ['icon-512-maskable.png', 512, 0.1],
]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(`<body style="margin:0;background:#111;display:grid;place-items:center;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await page.screenshot({ path: join(dir, name) });
  console.log(name);
}
await browser.close();
