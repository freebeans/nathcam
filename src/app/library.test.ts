import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Recipe } from '../engine/recipe';
import { History } from './history';
import { Library } from './library';
import { emptyRecipe, setUserParam } from './recipe-edit';

let lib: Library;
let n = 0;

beforeEach(() => {
  lib = new Library(`test-${++n}`);
});
afterEach(async () => {
  await lib.destroy();
});

function input(name: string) {
  return {
    name,
    type: 'image/jpeg',
    bytes: new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]),
    width: 400,
    height: 300,
    thumb: new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }),
    exif: { make: 'TestCam', date: '2026-11-20T10:00:00' },
  };
}

describe('Library', () => {
  it('guarda a foto e lista da mais recente para a mais antiga', async () => {
    const a = await lib.addPhoto(input('a.jpg'));
    await new Promise((r) => setTimeout(r, 2));
    const b = await lib.addPhoto(input('b.jpg'));
    const list = await lib.listPhotos();
    expect(list.map((p) => p.id)).toEqual([b, a]);
    expect(list[0]).toMatchObject({ name: 'b.jpg', width: 400, height: 300, exif: { make: 'TestCam' } });
  });

  it('devolve o original intacto', async () => {
    const id = await lib.addPhoto(input('a.jpg'));
    const p = await lib.getPhoto(id);
    expect(new Uint8Array(await p!.original.arrayBuffer())).toEqual(input('a.jpg').bytes);
  });

  it('foto nova começa com receita vazia e histórico de um passo', async () => {
    const id = await lib.addPhoto(input('a.jpg'));
    const edit = await lib.loadEdit(id);
    expect(edit.recipe).toEqual(emptyRecipe());
    expect(History.restore(edit.history, edit.recipe).length).toBe(1);
  });

  it('salva e recarrega receita, histórico e miniatura editada', async () => {
    const id = await lib.addPhoto(input('a.jpg'));
    const h = new History<Recipe>(emptyRecipe());
    const r1 = setUserParam(emptyRecipe(), 'exposure', 0.5);
    h.push(r1, 'exposure');
    const thumb = new Blob([new Uint8Array([7])], { type: 'image/jpeg' });
    await lib.saveEdit(id, r1, h.snapshot(), thumb);

    const edit = await lib.loadEdit(id);
    expect(edit.recipe).toEqual(r1);
    const restored = History.restore(edit.history, edit.recipe);
    expect(restored.undo()).toEqual(emptyRecipe());
    const p = await lib.getPhoto(id);
    expect(new Uint8Array(await p!.thumb!.arrayBuffer())).toEqual(new Uint8Array([7]));
    expect(p!.editedAt).toBeGreaterThan(0);
  });

  it('apagar remove foto, receita e histórico', async () => {
    const a = await lib.addPhoto(input('a.jpg'));
    const b = await lib.addPhoto(input('b.jpg'));
    await lib.saveEdit(a, emptyRecipe(), new History(emptyRecipe()).snapshot());
    await lib.deletePhotos([a]);
    expect((await lib.listPhotos()).map((p) => p.id)).toEqual([b]);
    expect(await lib.getPhoto(a)).toBeUndefined();
    expect((await lib.loadEdit(a)).recipe).toEqual(emptyRecipe());
  });
});
