import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCube } from '../src/engine/cube';
import type { PresetRecipe } from '../src/engine/recipe';
import { buildManifest } from './presets-manifest';

const publicDir = resolve('public');

describe('manifest dos presets oficiais', () => {
  const manifest = JSON.parse(buildManifest(publicDir)) as { packs: string[]; presets: PresetRecipe[] };

  it('tem os 14 presets do cssco', () => {
    const cssco = manifest.presets.filter((p) => p.pack === 'cssco');
    expect(cssco).toHaveLength(14);
    expect(manifest.packs).toContain('cssco');
  });

  it('nenhum preset publicado carrega extends', () => {
    for (const p of manifest.presets) expect('extends' in p).toBe(false);
  });

  it('toda LUT referenciada existe e é uma .cube válida', () => {
    for (const p of manifest.presets) {
      if (!p.lut) continue;
      const file = join(publicDir, p.lut.src);
      expect(existsSync(file), file).toBe(true);
      const lut = parseCube(readFileSync(file, 'utf8'));
      expect(lut.size, p.id).toBeGreaterThanOrEqual(13);
      expect(lut.size, p.id).toBeLessThanOrEqual(65);
    }
  });

  it('LUTs do cssco mantêm o aviso de copyright', () => {
    const text = readFileSync(join(publicDir, 'luts', 'cssco-c1.cube'), 'utf8');
    expect(text).toMatch(/MIT License, Copyright \(c\) 2016 Lauren Waller/);
    expect(existsSync(join(publicDir, 'luts', 'LICENSE-cssco.txt'))).toBe(true);
  });
});

describe('filtros de emulação de filme (G\'MIC, CC BY-SA 4.0)', () => {
  const manifest = JSON.parse(buildManifest(publicDir)) as { packs: string[]; presets: PresetRecipe[] };
  const gmic = manifest.presets.filter((p) => p.id.startsWith('gmic-'));

  it('vêm em packs próprios, depois do cssco', () => {
    expect(gmic.length).toBeGreaterThanOrEqual(80);
    expect(manifest.packs).toEqual(['cssco', 'filme', 'filme ±', 'p&b', 'slide', 'instantâneo', 'fuji', 'cinema']);
  });

  it('cada LUT carrega a atribuição e a licença (ou o aviso de uso pessoal, no pack fuji)', () => {
    for (const p of gmic) {
      const text = readFileSync(join(publicDir, p.lut!.src), 'utf8');
      expect(text, p.id).toMatch(/gmic\.eu/);
      expect(text, p.id).toMatch(p.pack === 'fuji' ? /uso pessoal/ : /CC BY-SA 4\.0/);
    }
    expect(existsSync(join(publicDir, 'licenses', 'gmic-clut-CC-BY-SA-4.0.txt'))).toBe(true);
  });

  it('ids únicos', () => {
    expect(new Set(gmic.map((p) => p.id)).size).toBe(gmic.length);
  });
});
