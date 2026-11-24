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
/** Uma LUT 129³ tem ~26 MB; nada legítimo passa disso por arquivo. */
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const LUT_ID = /^[\w-]{1,100}$/;

class TooLarge extends Error {}

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
  let total = 0;
  try {
    // Confere os tamanhos declarados antes de descompactar (zip bomb).
    files = unzipSync(zip, {
      filter: (f) => {
        total += f.originalSize;
        if (f.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) throw new TooLarge(f.name);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof TooLarge) throw new Error(`Backup grande demais ou corrompido (${e.message}).`);
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

  const entries = <T>(v: unknown): T[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

  const luts: LutRecord[] = entries<BackupLut>(json.luts).map((l) => {
    const data = isStr(l.file) ? files[l.file] : undefined;
    const size = l.size;
    if (!isStr(l.id) || !LUT_ID.test(l.id) || !Number.isInteger(size) || size < 2 || size > MAX_LUT_SIDE || !isTriple(l.domainMin) || !isTriple(l.domainMax))
      throw new Error(`LUT inválida no backup: ${String(l.id)}`);
    if (!data || data.byteLength !== size ** 3 * 3 * 4) throw new Error(`LUT ${l.id}: dados com tamanho inesperado.`);
    return { id: l.id, size, domainMin: l.domainMin, domainMax: l.domainMax, data: data.slice().buffer as ArrayBuffer };
  });

  // LUT local só vale se existir: no backup ou já no aparelho.
  const knownLuts = new Set([...luts.map((l) => l.id), ...((await db.luts.toCollection().primaryKeys()) as string[])]);
  const lutOf = (v: unknown): PresetLut | null => {
    const l = validLut(v);
    if (l?.src.startsWith(LOCAL_LUT_PREFIX) && !knownLuts.has(l.src.slice(LOCAL_LUT_PREFIX.length))) return null;
    return l;
  };

  const presets: PresetRecord[] = entries<PresetRecord>(json.presets)
    .filter((p) => isStr(p.id) && isStr(p.name) && isStr(p.pack))
    .map((p) => ({
      id: p.id,
      name: p.name,
      pack: p.pack,
      params: sanitizeParams(p.params).params,
      lut: lutOf(p.lut),
      engineVersion: typeof p.engineVersion === 'number' ? p.engineVersion : 1,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    }));

  const meta: PresetMetaRecord[] = entries<PresetMetaRecord>(json.meta)
    .filter((m) => isStr(m.id) && /^(preset|pack):/.test(m.id))
    .map((m) => ({ id: m.id, ...(m.favorite === true && { favorite: true }), ...(m.hidden === true && { hidden: true }) }));

  await db.transaction('rw', db.presets, db.luts, db.presetMeta, async () => {
    await db.luts.bulkPut(luts);
    await db.presets.bulkPut(presets);
    await db.presetMeta.bulkPut(meta);
  });
  return { presets: presets.length, luts: luts.length };
}
