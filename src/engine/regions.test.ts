import { describe, expect, it } from 'vitest';
import { planPasses, radiiFor, tilesFor } from './regions';

describe('radiiFor', () => {
  it('raios são proporcionais ao lado maior da imagem', () => {
    const a = radiiFor(1000, 800);
    const b = radiiFor(4000, 3200);
    expect(b.clarityRadius / a.clarityRadius).toBeCloseTo(4);
    expect(b.textureRadius / a.textureRadius).toBeCloseTo(4);
    expect(b.sharpenRadius / a.sharpenRadius).toBeCloseTo(4);
  });
});

describe('planPasses', () => {
  const radii = radiiFor(4000, 3000);

  it('B contém C com margem para a nitidez; A contém B com margem para a clareza', () => {
    const p = planPasses({ x: 1000, y: 500, w: 512, h: 256 }, radii);
    const inside = (o: typeof p.a, i: typeof p.c, m: number) =>
      o.x <= i.x - m && o.y <= i.y - m && o.x + o.w >= i.x + i.w + m && o.y + o.h >= i.y + i.h + m;
    expect(inside(p.b, p.c, Math.ceil(radii.sharpenRadius))).toBe(true);
    expect(inside(p.a, p.b, Math.ceil(radii.clarityRadius / 2))).toBe(true);
  });

  it('A fica alinhado à grade do maior nível de mip usado', () => {
    const p = planPasses({ x: 1001, y: 333, w: 517, h: 259 }, radii);
    const g = 2 ** Math.ceil(Math.max(radii.clarityLod, radii.textureLod));
    expect(p.a.x % g).toBe(0);
    expect(p.a.y % g).toBe(0);
    expect(p.a.w % g).toBe(0);
    expect(p.a.h % g).toBe(0);
  });
});

describe('tilesFor', () => {
  it('cobre a imagem inteira sem sobreposição', () => {
    const tiles = tilesFor(5000, 3000, 2048);
    expect(tiles.length).toBe(3 * 2);
    const area = tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(area).toBe(5000 * 3000);
    expect(tiles.at(-1)).toEqual({ x: 4096, y: 2048, w: 904, h: 952 });
  });
});
