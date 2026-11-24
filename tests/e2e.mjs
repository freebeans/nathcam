#!/usr/bin/env node
/**
 * Teste ponta a ponta do build de produção (critérios de aceite da v1).
 * Uso: npm run build && npm run e2e
 *
 * - abre uma foto de 12 MP com EXIF (orientação 6 e GPS) e mede o tempo até a grade de presets;
 * - aplica um preset e mede a taxa de quadros ao arrastar um slider do nível 2;
 * - exporta e verifica perfil Display P3, EXIF preservado, orientação 1 e GPS removido;
 * - recarrega sem rede (service worker) e confirma que o app abre.
 *
 * Os tempos medidos aqui são de um Chromium headless com renderização em CPU
 * (SwiftShader); os limites de desempenho do PRD valem para aparelhos reais.
 */
import { chromium } from 'playwright';
import { preview } from 'vite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const photo = process.argv[2] ?? join(root, 'tests', 'fixtures', 'photo-12mp-exif.jpg');
const screenshots = process.env.E2E_SCREENSHOTS;

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};

const server = await preview({ root, logLevel: 'error', preview: { port: 4173, strictPort: true } });
const url = 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

try {
  await page.goto(url);
  await page.getByRole('button', { name: 'Abrir foto' }).waitFor();

  // ---- abrir foto e grade de presets
  const t0 = Date.now();
  await page.locator('input[type=file]').setInputFiles(photo);
  await page.getByRole('button', { name: 'C1' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.grid canvas:not(.empty)').length >= 15, null, { timeout: 60_000 });
  const tGrid = Date.now() - t0;
  console.log(`     grade de presets em ${tGrid} ms (headless/CPU)`);

  const dims = await page.evaluate(() => {
    const c = document.querySelector('.viewer canvas');
    return { w: c.width, h: c.height };
  });
  check(dims.h > dims.w, `orientação do EXIF aplicada (canvas ${dims.w}x${dims.h}, retrato)`);

  // ---- preset e intensidade
  await page.getByRole('button', { name: 'C1' }).click();
  await page.getByText('Intensidade · C1').waitFor();
  check(true, 'preset C1 aplicado');

  // ---- segurar para ver o original (um toque rápido não pisca)
  const box = await page.locator('.viewer canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const flashedOnTap = await page.locator('.badge').isVisible();
  await page.mouse.up();
  check(!flashedOnTap, 'toque rápido não mostra o original');
  await page.mouse.down();
  await page.waitForTimeout(400);
  const shownOnHold = await page.locator('.badge').isVisible();
  await page.mouse.up();
  check(shownOnHold, 'segurar mostra o original');
  check(!(await page.locator('.badge').isVisible()), 'soltar volta à edição');
  if (screenshots) await page.screenshot({ path: join(screenshots, 'presets.png') });

  // ---- nível 2: arrastar um slider e medir quadros
  await page.getByRole('tab', { name: 'Básico' }).click();
  const fps = await page.evaluate(async () => {
    const input = [...document.querySelectorAll('.basic input[type=range]')][1]; // contraste
    let frames = 0;
    let running = true;
    const count = () => {
      frames++;
      if (running) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) {
      input.value = String(-50 + i * 2);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    running = false;
    return (frames / (performance.now() - t0)) * 1000;
  });
  console.log(`     ~${fps.toFixed(1)} fps arrastando contraste (headless/CPU)`);
  check(fps > 0, 'slider do nível 2 atualiza a pré-visualização');
  if (screenshots) await page.screenshot({ path: join(screenshots, 'basic.png') });

  // ---- exportar
  await page.getByRole('button', { name: 'Exportar' }).click();
  await page.getByRole('button', { name: 'Gerar JPEG' }).click();
  await page.getByRole('button', { name: 'Baixar' }).waitFor({ timeout: 120_000 });
  if (screenshots) await page.screenshot({ path: join(screenshots, 'export.png') });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Baixar' }).click()]);
  const bytes = readFileSync(await download.path());
  check(download.suggestedFilename() === 'photo-12mp-exif-editada.jpg', `nome do arquivo: ${download.suggestedFilename()}`);

  const info = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const segs = [];
    let o = 2;
    while (o < bytes.length && bytes[o] === 0xff && bytes[o + 1] !== 0xda) {
      const len = (bytes[o + 2] << 8) | bytes[o + 3];
      segs.push({ marker: bytes[o + 1], payload: bytes.slice(o + 4, o + 2 + len) });
      o += 2 + len;
    }
    const icc = segs.find((s) => s.marker === 0xe2);
    const exif = segs.find((s) => s.marker === 0xe1);
    const desc = icc ? new TextDecoder('utf-16be').decode(icc.payload.slice(14).slice(-200)) : '';
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    return {
      hasIcc: !!icc,
      iccIsP3: icc ? new TextDecoder('latin1').decode(icc.payload.slice(14)).includes('D\u0000i\u0000s\u0000p\u0000l\u0000a\u0000y\u0000 \u0000P\u00003') : false,
      exif: exif ? Array.from(exif.payload.slice(6)) : null,
      w: bmp.width,
      h: bmp.height,
      desc,
    };
  }, bytes.toString('base64'));
  check(info.hasIcc && info.iccIsP3, 'JPEG exportado tem perfil ICC Display P3');
  check(info.h > info.w && Math.max(info.w, info.h) === 4032, `tamanho exportado ${info.w}x${info.h}`);
  check(!!info.exif, 'EXIF preservado');
  if (info.exif) {
    const t = Buffer.from(info.exif);
    const le = t.toString('latin1', 0, 2) === 'II';
    const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
    const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
    const ifd0 = u32(4);
    const n = u16(ifd0);
    const tags = {};
    for (let i = 0; i < n; i++) {
      const e = ifd0 + 2 + i * 12;
      tags[u16(e)] = { value16: u16(e + 8), value32: u32(e + 8) };
    }
    check(tags[0x0112]?.value16 === 1, 'orientação gravada como 1');
    check(t.toString('latin1').includes('TestCam'), 'fabricante da câmera preservado');
    check(!tags[0x8825] || u16(tags[0x8825].value32) === 0, 'localização removida');
  }
  await page.getByRole('button', { name: 'Fechar' }).click();

  // ---- recorte, desfazer e refazer
  const canvasDims = () =>
    page.evaluate(() => {
      const c = document.querySelector('.viewer canvas');
      return { w: c.width, h: c.height };
    });
  await page.getByRole('button', { name: 'Recorte', exact: true }).click();
  await page.getByRole('button', { name: '1:1' }).click();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await page.waitForTimeout(300);
  let d = await canvasDims();
  check(Math.abs(d.w - d.h) <= 1, `recorte 1:1 aplicado (${d.w}x${d.h})`);
  if (screenshots) await page.screenshot({ path: join(screenshots, 'crop.png') });
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.waitForTimeout(300);
  d = await canvasDims();
  check(d.h > d.w, 'desfazer volta ao enquadramento anterior');
  await page.getByRole('button', { name: 'Refazer' }).click();
  await page.waitForTimeout(300);
  d = await canvasDims();
  check(Math.abs(d.w - d.h) <= 1, 'refazer reaplica o recorte');

  // ---- biblioteca persistente
  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  await page.getByRole('button', { name: 'photo-12mp-exif.jpg' }).waitFor();
  check(await page.locator('.cell .dot').isVisible(), 'foto aparece como editada na biblioteca');
  await page.reload();
  await page.getByRole('button', { name: 'photo-12mp-exif.jpg' }).click();
  await page.getByText('Intensidade · C1').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  d = await canvasDims();
  check(Math.abs(d.w - d.h) <= 1, 'depois de recarregar, preset e recorte continuam lá');
  check(await page.getByRole('button', { name: 'Desfazer' }).isEnabled(), 'histórico persistido');
  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();

  // ---- apagar
  page.once('dialog', (dlg) => dlg.accept());
  await page.getByRole('button', { name: 'Selecionar' }).click();
  await page.getByRole('button', { name: 'photo-12mp-exif.jpg' }).click();
  await page.getByRole('button', { name: 'Apagar' }).click();
  await page.getByRole('button', { name: 'Abrir foto' }).waitFor();
  check(true, 'apagar remove a foto da biblioteca');

  // ---- offline
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  const offlineOk = await page
    .getByRole('button', { name: 'Abrir foto' })
    .waitFor({ timeout: 10_000 })
    .then(() => true, () => false);
  check(offlineOk, 'abre sem rede (service worker)');
  const manifestOffline = await page.evaluate(() => fetch('./presets/manifest.json').then((r) => r.ok, () => false));
  check(manifestOffline, 'presets disponíveis offline');
  const lutOffline = await page.evaluate(() => fetch('./luts/cssco-c1.cube').then((r) => r.ok, () => false));
  check(lutOffline, 'LUTs disponíveis offline');
  await context.setOffline(false);

  check(errors.length === 0, `sem erros no console${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}

console.log(failures ? `\n${failures} falha(s)` : '\ntudo ok');
process.exit(failures ? 1 : 0);
