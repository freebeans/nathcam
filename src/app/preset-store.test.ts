import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Lut3D } from '../engine/cube';
import type { PresetRecipe } from '../engine/recipe';
import { Db } from './db';
import { PresetStore, LOCAL_LUT_PREFIX } from './preset-store';

let db: Db;
let store: PresetStore;
let n = 0;

beforeEach(() => {
  db = new Db(`presets-${++n}`);
  store = new PresetStore(db);
});
afterEach(async () => {
  await db.delete();
});

const lut: Lut3D = { size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: new Float32Array(24).map((_, i) => i / 24) };
const base = (over: Partial<PresetRecipe> = {}): Omit<PresetRecipe, 'id'> => ({
  name: 'Portra',
  pack: 'comunidade',
  params: { exposure: 0.2 },
  lut: null,
  engineVersion: 1,
  ...over,
});

describe('PresetStore', () => {
  it('cria preset local com id novo e lista em ordem de criação', async () => {
    const a = await store.create(base({ name: 'A' }));
    const b = await store.create(base({ name: 'B' }));
    expect(a.id).not.toBe(b.id);
    expect((await store.list()).map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('guarda a LUT em binário e a referencia como local', async () => {
    const p = await store.create(base(), { lut, colorSpace: 'srgb' });
    expect(p.lut?.src.startsWith(LOCAL_LUT_PREFIX)).toBe(true);
    expect(p.lut?.colorSpace).toBe('srgb');
    const back = await store.getLut(p.lut!.src);
    expect(back.size).toBe(2);
    expect(Array.from(back.data)).toEqual(Array.from(lut.data));
  });

  it('atualiza preset existente (editar, renomear, mover de pack)', async () => {
    const p = await store.create(base());
    await store.update({ ...p, name: 'Portra 2', pack: 'meus' });
    expect(await store.list()).toEqual([expect.objectContaining({ id: p.id, name: 'Portra 2', pack: 'meus' })]);
  });

  it('apagar remove a LUT local quando ninguém mais a usa', async () => {
    const a = await store.create(base(), { lut, colorSpace: 'srgb' });
    const b = await store.create({ ...base(), lut: a.lut });
    await store.remove(a.id);
    await expect(store.getLut(a.lut!.src)).resolves.toBeTruthy();
    await store.remove(b.id);
    await expect(store.getLut(a.lut!.src)).rejects.toThrow();
  });

  it('favoritos e ocultos (preset e pack)', async () => {
    await store.setFavorite('c1', true);
    await store.setHidden('a6', true);
    await store.setPackHidden('comunidade', true);
    let prefs = await store.prefs();
    expect([...prefs.favorites]).toEqual(['c1']);
    expect([...prefs.hidden]).toEqual(['a6']);
    expect([...prefs.hiddenPacks]).toEqual(['comunidade']);
    await store.setFavorite('c1', false);
    prefs = await store.prefs();
    expect(prefs.favorites.size).toBe(0);
  });

  it('apagar preset limpa as preferências dele', async () => {
    const p = await store.create(base());
    await store.setFavorite(p.id, true);
    await store.remove(p.id);
    expect((await store.prefs()).favorites.has(p.id)).toBe(false);
  });
});

describe('LUT usada por fotos', () => {
  it('apagar o preset mantém a LUT se alguma foto (receita ou histórico) ainda a usa', async () => {
    const p = await store.create(base(), { lut, colorSpace: 'srgb' });
    const recipe = { engineVersion: 1, preset: p, intensity: 1, user: {} };
    await db.recipes.put({ photoId: 'foto', recipe, updatedAt: 0 });
    await store.remove(p.id);
    await expect(store.getLut(p.lut!.src)).resolves.toBeTruthy();

    await db.recipes.clear();
    await db.history.put({ photoId: 'foto', snapshot: { entries: [recipe], index: 0 } });
    const q = await store.create({ ...base(), lut: p.lut });
    await store.remove(q.id);
    await expect(store.getLut(p.lut!.src)).resolves.toBeTruthy();

    await db.history.clear();
    const r = await store.create({ ...base(), lut: p.lut });
    await store.remove(r.id);
    await expect(store.getLut(p.lut!.src)).rejects.toThrow();
  });
});
