/**
 * Backup `.zip` dos presets locais, packs, favoritos, ocultos e LUTs locais
 * (ver PRD, "Dados e armazenamento"). A biblioteca (fotos e receitas) não
 * entra: os originais continuam no rolo da câmera.
 *
 * Formato: `backup.json` (presets, preferências e índice das LUTs) e
 * `luts/<id>.bin` (Float32 little-endian, RGB, vermelho variando mais rápido).
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { PresetLut } from '../engine/recipe';
import { sanitizeParams } from '../presets/import';
import type { Db, LutRecord, PresetMetaRecord, PresetRecord } from './db';
import { LOCAL_LUT_PREFIX } from './preset-store';

const FORMAT = 'nathcam-backup';
const VERSION = 1;
const MAX_LUT_SIDE = 129;

interface BackupLut extends Omit<LutRecord, 'data'> {
  file: string;
}

interface BackupJson {
  format: typeof FORMAT;
  version: number;
  createdAt: string;
  presets: PresetRecord[];
  meta: PresetMetaRecord[];
  luts: BackupLut[];
}

export async function createBackup(db: Db): Promise<Uint8Array> {
  const [presets, meta, luts] = await Promise.all([db.presets.toArray(), db.presetMeta.toArray(), db.luts.toArray()]);
  const files: Zippable = {};
  const index: BackupLut[] = luts.map(({ data, ...rest }) => {
    const file = `luts/${rest.id}.bin`;
    files[file] = new Uint8Array(data);
    return { ...rest, file };
  });
  const json: BackupJson = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), presets, meta, luts: index };
  files['backup.json'] = strToU8(JSON.stringify(json, null, 2));
  return zipSync(files, { level: 6 });
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 500;
const isTriple = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

function validLut(v: unknown): PresetLut | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Record<string, unknown>;
  const srcOk = isStr(l.src) && (l.src.startsWith(LOCAL_LUT_PREFIX) || /^luts\/[\w.-]+\.cube$/.test(l.src));
  if (!srcOk || (l.colorSpace !== 'srgb' && l.colorSpace !== 'display-p3')) return null;
  const out: PresetLut = { src: l.src as string, colorSpace: l.colorSpace };
  if (typeof l.amount === 'number' && l.amount >= 0 && l.amount <= 1) out.amount = l.amount;
  return out;
}

/** Restaura um backup por cima do que existe (mesmos ids são substituídos). */
export async function restoreBackup(db: Db, zip: Uint8Array): Promise<{ presets: number; luts: number }> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new Error('Arquivo inválido: não é um .zip.');
  }
  const raw = files['backup.json'];
  if (!raw) throw new Error('Este .zip não é um backup do nathcam.');
  let json: BackupJson;
  try {
    json = JSON.parse(strFromU8(raw));
  } catch {
    throw new Error('backup.json inválido.');
  }
  if (json.format !== FORMAT || typeof json.version !== 'number') throw new Error('Este .zip não é um backup do nathcam.');
  if (json.version > VERSION) throw new Error('Backup feito por uma versão mais nova do app.');

  const luts: LutRecord[] = (Array.isArray(json.luts) ? json.luts : []).map((l) => {
    const data = files[l.file];
    const size = l.size;
    if (!isStr(l.id) || !Number.isInteger(size) || size < 2 || size > MAX_LUT_SIDE || !isTriple(l.domainMin) || !isTriple(l.domainMax))
      throw new Error(`LUT inválida no backup: ${String(l.id)}`);
    if (!data || data.byteLength !== size ** 3 * 3 * 4) throw new Error(`LUT ${l.id}: dados com tamanho inesperado.`);
    return { id: l.id, size, domainMin: l.domainMin, domainMax: l.domainMax, data: data.slice().buffer as ArrayBuffer };
  });

  const presets: PresetRecord[] = (Array.isArray(json.presets) ? json.presets : [])
    .filter((p) => isStr(p?.id) && isStr(p?.name) && isStr(p?.pack))
    .map((p) => ({
      id: p.id,
      name: p.name,
      pack: p.pack,
      params: sanitizeParams(p.params).params,
      lut: validLut(p.lut),
      engineVersion: typeof p.engineVersion === 'number' ? p.engineVersion : 1,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    }));

  const meta: PresetMetaRecord[] = (Array.isArray(json.meta) ? json.meta : [])
    .filter((m) => isStr(m?.id) && /^(preset|pack):/.test(m.id))
    .map((m) => ({ id: m.id, ...(m.favorite === true && { favorite: true }), ...(m.hidden === true && { hidden: true }) }));

  await db.transaction('rw', db.presets, db.luts, db.presetMeta, async () => {
    await db.luts.bulkPut(luts);
    await db.presets.bulkPut(presets);
    await db.presetMeta.bulkPut(meta);
  });
  return { presets: presets.length, luts: luts.length };
}
