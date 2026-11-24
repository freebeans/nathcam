import { describe, expect, it } from 'vitest';
import type { PresetRecipe } from '../engine/recipe';
import { organize, type PresetItem, type PresetPrefs } from './organize';

const p = (id: string, name: string, pack: string, local = false): PresetItem => ({
  preset: { id, name, pack, params: {}, lut: null, engineVersion: 1 } as PresetRecipe,
  local,
});

const items = [
  p('c1', 'C1', 'cssco'),
  p('a6', 'A6', 'cssco'),
  p('m5', 'M5', 'cssco'),
  p('x', 'Pôr do sol', 'comunidade', true),
  p('y', 'Portra 400', 'comunidade', true),
  p('z', 'C1 (meu)', 'meus', true),
];
const none: PresetPrefs = { favorites: new Set(), hidden: new Set(), hiddenPacks: new Set() };
const ids = (xs: PresetItem[]) => xs.map((x) => x.preset.id);

describe('organize', () => {
  it('packs como abas: oficiais na ordem do manifest, depois "meus", depois os outros', () => {
    const o = organize(items, none, { packOrder: ['cssco'] });
    expect(o.packs).toEqual(['cssco', 'meus', 'comunidade']);
    expect(ids(o.byPack.cssco)).toEqual(['c1', 'a6', 'm5']);
  });

  it('favoritos no topo do pack, mantendo a ordem', () => {
    const o = organize(items, { ...none, favorites: new Set(['m5', 'a6']) }, { packOrder: ['cssco'] });
    expect(ids(o.byPack.cssco)).toEqual(['a6', 'm5', 'c1']);
  });

  it('ocultar preset e pack inteiro; "mostrar ocultos" traz de volta', () => {
    const prefs = { ...none, hidden: new Set(['a6']), hiddenPacks: new Set(['comunidade']) };
    const o = organize(items, prefs, { packOrder: ['cssco'] });
    expect(ids(o.byPack.cssco)).toEqual(['c1', 'm5']);
    expect(o.packs).not.toContain('comunidade');
    const all = organize(items, prefs, { packOrder: ['cssco'], showHidden: true });
    expect(ids(all.byPack.cssco)).toEqual(['c1', 'a6', 'm5']);
    expect(all.packs).toContain('comunidade');
  });

  it('pack sem nenhum preset visível some das abas', () => {
    const o = organize(items, { ...none, hidden: new Set(['z']) }, { packOrder: ['cssco'] });
    expect(o.packs).not.toContain('meus');
  });

  it('busca por nome em todos os packs, sem diferenciar acentos e maiúsculas', () => {
    const o = organize(items, { ...none, favorites: new Set(['z']) }, { packOrder: ['cssco'], query: 'c1' });
    expect(ids(o.search!)).toEqual(['z', 'c1']);
    expect(ids(organize(items, none, { query: 'por' }).search!)).toEqual(['x', 'y']);
  });

  it('sem busca, search é null', () => {
    expect(organize(items, none, { query: '  ' }).search).toBeNull();
  });
});
