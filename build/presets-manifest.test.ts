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
      expect([17, 33, 65]).toContain(lut.size);
    }
  });

  it('LUTs do cssco mantêm o aviso de copyright', () => {
    const text = readFileSync(join(publicDir, 'luts', 'cssco-c1.cube'), 'utf8');
    expect(text).toMatch(/MIT License, Copyright \(c\) 2016 Lauren Waller/);
    expect(existsSync(join(publicDir, 'luts', 'LICENSE-cssco.txt'))).toBe(true);
  });
});
