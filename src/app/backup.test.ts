import 'fake-indexeddb/auto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Lut3D } from '../engine/cube';
import { createBackup, restoreBackup } from './backup';
import { Db } from './db';
import { PresetStore } from './preset-store';

let n = 0;
let a: { db: Db; store: PresetStore };
let b: { db: Db; store: PresetStore };
const open = () => {
  const db = new Db(`backup-${++n}`);
  return { db, store: new PresetStore(db) };
};

beforeEach(() => {
  a = open();
  b = open();
});
afterEach(async () => {
  await a.db.delete();
  await b.db.delete();
});

const lut: Lut3D = { size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: new Float32Array(24).map((_, i) => i / 23) };

describe('backup .zip', () => {
  it('ida e volta: presets, packs, LUTs, favoritos e ocultos', async () => {
    const p1 = await a.store.create({ name: 'Portra', pack: 'comunidade', params: { exposure: 0.3 }, lut: null, engineVersion: 1 }, { lut, colorSpace: 'srgb' });
    const p2 = await a.store.create({ name: 'Meu', pack: 'meus', params: { fade: 10 }, lut: null, engineVersion: 1 });
    await a.store.setFavorite(p2.id, true);
    await a.store.setFavorite('cssco-c1', true);
    await a.store.setHidden('cssco-a6', true);
    await a.store.setPackHidden('comunidade', true);

    const zip = await createBackup(a.db);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toContain('backup.json');

    const res = await restoreBackup(b.db, zip);
    expect(res).toEqual({ presets: 2, luts: 1 });
    const list = await b.store.list();
    expect(list.map((p) => [p.id, p.name, p.pack])).toEqual([
      [p1.id, 'Portra', 'comunidade'],
      [p2.id, 'Meu', 'meus'],
    ]);
    const back = await b.store.getLut(list[0].lut!.src);
    expect(Array.from(back.data)).toEqual(Array.from(lut.data));
    const prefs = await b.store.prefs();
    expect([...prefs.favorites].sort()).toEqual([p2.id, 'cssco-c1'].sort());
    expect([...prefs.hidden]).toEqual(['cssco-a6']);
    expect([...prefs.hiddenPacks]).toEqual(['comunidade']);
  });

  it('restaurar duas vezes não duplica (mesmos ids)', async () => {
    await a.store.create({ name: 'A', pack: 'meus', params: {}, lut: null, engineVersion: 1 });
    const zip = await createBackup(a.db);
    await restoreBackup(b.db, zip);
    await restoreBackup(b.db, zip);
    expect(await b.store.list()).toHaveLength(1);
  });

  it('não inclui a biblioteca (fotos e receitas)', async () => {
    await a.db.photos.add({
      id: 'f', name: 'x.jpg', type: 'image/jpeg', original: new Blob([new Uint8Array([1])]), thumb: null,
      width: 1, height: 1, exif: {}, importedAt: 0,
    });
    const files = unzipSync(await createBackup(a.db));
    expect(JSON.stringify(JSON.parse(new TextDecoder().decode(files['backup.json'])))).not.toContain('x.jpg');
  });

  it('recusa zip que não é backup do app', async () => {
    const other = zipSync({ 'readme.txt': strToU8('oi') });
    await expect(restoreBackup(b.db, other)).rejects.toThrow(/backup/);
    await expect(restoreBackup(b.db, new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it('valida os parâmetros dos presets restaurados', async () => {
    const bad = zipSync({
      'backup.json': strToU8(
        JSON.stringify({
          format: 'nathcam-backup',
          version: 1,
          presets: [{ id: 'x', name: 'X', pack: 'meus', params: { exposure: 99, evil: 1 }, lut: null, engineVersion: 1, createdAt: 1 }],
          luts: [],
          meta: [],
        }),
      ),
    });
    await restoreBackup(b.db, bad);
    expect((await b.store.list())[0].params).toEqual({ exposure: 5 });
  });

  it('LUT com tamanho de dados inconsistente é recusada', async () => {
    const bad = zipSync({
      'backup.json': strToU8(
        JSON.stringify({
          format: 'nathcam-backup',
          version: 1,
          presets: [],
          luts: [{ id: 'l', size: 3, domainMin: [0, 0, 0], domainMax: [1, 1, 1], file: 'luts/l.bin' }],
          meta: [],
        }),
      ),
      'luts/l.bin': new Uint8Array(8),
    });
    await expect(restoreBackup(b.db, bad)).rejects.toThrow(/LUT/);
  });
});
