#!/usr/bin/env node
/**
 * Converte os 14 filtros do cssco (MIT, © 2016 Lauren Waller) em LUTs `.cube`
 * e presets `.json`. Script único, fora do app.
 *
 * Como funciona: cada filtro CSS é aplicado, num Chromium headless, sobre uma
 * imagem-identidade (todas as cores de uma grade 33³ lado a lado); a captura
 * da tela, lida pixel a pixel, vira a LUT. Os degradês de fundo do cssco
 * variam com a posição e não cabem numa LUT: são trocados pela cor média.
 *
 * Uso: npm run convert:cssco
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const N = 33;
const W = N * N;
const H = N;

const PRESETS = ['c1', 'f2', 'g3', 'p5', 'lv3', 'b5', 'a6', 'm5', 'm3', 'hb1', 'hb2', 'acg', 'x1', 't1'];

const css = readFileSync(join(here, 'cssco.css'), 'utf8');

const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: W + 20, height: 400 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><head><style>
  html, body { margin: 0; background: #fff; }
  ${css}
  .cssco img { image-rendering: pixelated; }
  #stage { position: absolute; left: 0; top: 0; width: ${W}px; }
  #probe { position: absolute; left: 0; top: 100px; width: ${W}px; height: ${H}px; }
</style><style id="override"></style></head><body>
  <div id="stage"></div><div id="probe"></div>
</body></html>`);

/** Imagem-identidade: x = r + b*N, y = g. */
const identityUrl = await page.evaluate(
  ({ N, W, H }) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let g = 0; g < N; g++)
      for (let b = 0; b < N; b++)
        for (let r = 0; r < N; r++) {
          const i = (g * W + r + b * N) * 4;
          img.data[i] = Math.round((r * 255) / (N - 1));
          img.data[i + 1] = Math.round((g * 255) / (N - 1));
          img.data[i + 2] = Math.round((b * 255) / (N - 1));
          img.data[i + 3] = 255;
        }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  },
  { N, W, H },
);

async function decodePng(buf) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, data: Array.from(ctx.getImageData(0, 0, bmp.width, bmp.height).data) };
  }, buf.toString('base64'));
}

/** Cor média de um background-image (degradê) renderizado no tamanho da imagem. */
async function averageOf(backgroundImage) {
  await page.evaluate((bg) => (document.getElementById('probe').style.backgroundImage = bg), backgroundImage);
  const shot = await page.locator('#probe').screenshot();
  const { data } = await decodePng(shot);
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  const n = data.length / 4;
  return sum.map((s) => Math.round(s / n));
}

const lutDir = join(root, 'public', 'luts');
const presetDir = join(root, 'public', 'presets');
mkdirSync(lutDir, { recursive: true });
mkdirSync(presetDir, { recursive: true });

const header = (name) =>
  [
    `# cssco ${name.toUpperCase()} convertido para LUT 3D (${N}³).`,
    '# Fonte: https://github.com/ughnett/cssco — MIT License, Copyright (c) 2016 Lauren Waller.',
    '# Degradês de fundo substituídos pela cor média. Gerado por scripts/cssco/convert.mjs.',
    `TITLE "cssco ${name.toUpperCase()}"`,
    `LUT_3D_SIZE ${N}`,
    'DOMAIN_MIN 0 0 0',
    'DOMAIN_MAX 1 1 1',
  ].join('\n');

for (const name of PRESETS) {
  await page.evaluate(
    ({ name, url }) => {
      document.getElementById('override').textContent = '';
      document.getElementById('stage').innerHTML = `<div class="cssco cssco--${name}"><img src="${url}"></div>`;
      return document.querySelector('#stage img').decode();
    },
    { name, url: identityUrl },
  );

  const bgs = await page.evaluate(() => {
    const el = document.querySelector('#stage .cssco');
    return { main: getComputedStyle(el).backgroundImage, after: getComputedStyle(el, '::after').backgroundImage };
  });
  const rules = [];
  if (bgs.main.includes('gradient')) {
    const [r, g, b] = await averageOf(bgs.main);
    rules.push(`.cssco.cssco--${name} { background: rgb(${r}, ${g}, ${b}) !important; }`);
  }
  if (bgs.after.includes('gradient')) {
    const [r, g, b] = await averageOf(bgs.after);
    rules.push(`.cssco.cssco--${name}:after { background: rgb(${r}, ${g}, ${b}) !important; }`);
  }
  await page.evaluate((css) => (document.getElementById('override').textContent = css), rules.join('\n'));

  const shot = await page.locator('#stage .cssco').screenshot();
  const { w, h, data } = await decodePng(shot);
  if (w !== W || h !== H) throw new Error(`${name}: captura ${w}x${h}, esperado ${W}x${H}`);

  const lines = [header(name)];
  for (let b = 0; b < N; b++)
    for (let g = 0; g < N; g++)
      for (let r = 0; r < N; r++) {
        const i = (g * W + r + b * N) * 4;
        const f = (v) => (v / 255).toFixed(4);
        lines.push(`${f(data[i])} ${f(data[i + 1])} ${f(data[i + 2])}`);
      }
  writeFileSync(join(lutDir, `cssco-${name}.cube`), lines.join('\n') + '\n');

  const preset = {
    id: `cssco-${name}`,
    name: name.toUpperCase(),
    pack: 'cssco',
    extends: null,
    params: {},
    lut: { src: `luts/cssco-${name}.cube`, colorSpace: 'srgb' },
    engineVersion: 1,
  };
  writeFileSync(join(presetDir, `cssco-${name}.json`), JSON.stringify(preset, null, 2) + '\n');
  console.log(`cssco-${name}: ok${rules.length ? ' (degradê -> cor média)' : ''}`);
}

copyFileSync(join(here, 'LICENSE-cssco'), join(lutDir, 'LICENSE-cssco.txt'));
await browser.close();
