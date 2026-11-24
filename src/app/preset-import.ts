/**
 * Importação de presets a partir de arquivos (ver PRD, "Importação e
 * exportação"): `.json` próprio, `.cube`, `.xmp` do Lightroom e HaldCLUT
 * (`.png`). Tudo vira preset local no aparelho; nada vai para o repositório.
 */
import { parseCube, type Lut3D } from '../engine/cube';
import type { PresetRecipe } from '../engine/recipe';
import { ENGINE_VERSION } from '../engine/version';
import { MAX_IMPORT_BYTES, MAX_LUT_SIZE, checkHaldSize, haldToLut, parsePresetJson, resampleLut } from '../presets/import';
import { parseXmp } from '../presets/xmp';
import type { PresetStore } from './preset-store';

/** Pack padrão dos presets importados. */
export const IMPORT_PACK = 'importados';

export interface ImportResult {
  created: PresetRecipe[];
  errors: string[];
  /** Avisos: o que cada arquivo tinha e não foi aplicado. */
  notes: string[];
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

async function decodeHald(file: File): Promise<Lut3D> {
  const bmp = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    // Antes de alocar os pixels: Halds enormes derrubariam o Safari do iPhone.
    checkHaldSize(bmp.width, bmp.height);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { colorSpace: 'srgb' })!;
    ctx.drawImage(bmp, 0, 0);
    return haldToLut(ctx.getImageData(0, 0, bmp.width, bmp.height).data, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

async function importOne(file: File, store: PresetStore, notes: string[]): Promise<PresetRecipe> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (file.size > MAX_IMPORT_BYTES) throw new Error(`${file.name}: arquivo grande demais (máximo ${MAX_IMPORT_BYTES >> 20} MB).`);
  const blank = { pack: IMPORT_PACK, params: {}, lut: null, engineVersion: ENGINE_VERSION };
  switch (ext) {
    case 'json': {
      const p = parsePresetJson(await file.text(), file.name);
      if (p.ignored.length) notes.push(`${file.name}: ignorado ${p.ignored.join(', ')}`);
      return store.create({ ...blank, name: p.name, pack: p.pack ?? IMPORT_PACK, params: p.params, lut: p.lut });
    }
    case 'cube': {
      let lut = parseCube(await file.text());
      if (lut.size > MAX_LUT_SIZE) lut = resampleLut(lut, MAX_LUT_SIZE);
      return store.create({ ...blank, name: lut.title || baseName(file.name) }, { lut, colorSpace: 'srgb' });
    }
    case 'xmp': {
      const p = parseXmp(await file.text(), file.name);
      if (p.ignored.length) notes.push(`${p.name}: ignorado ${p.ignored.join(', ')}`);
      return store.create({ ...blank, name: p.name, pack: p.group ?? IMPORT_PACK, params: p.params });
    }
    case 'png':
      return store.create({ ...blank, name: baseName(file.name) }, { lut: await decodeHald(file), colorSpace: 'srgb' });
    default:
      throw new Error(`${file.name}: formato não suportado (use .json, .cube, .xmp ou HaldCLUT .png).`);
  }
}

export async function importPresetFiles(files: File[], store: PresetStore): Promise<ImportResult> {
  const out: ImportResult = { created: [], errors: [], notes: [] };
  for (const f of files) {
    try {
      out.created.push(await importOne(f, store, out.notes));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(msg.startsWith(f.name) ? msg : `${f.name}: ${msg}`);
    }
  }
  return out;
}
