import { describe, expect, it } from 'vitest';
import { applyMat3 } from './color';
import {
  constrainCrop,
  cropFits,
  fitTowards,
  flipCrop,
  rotateCropClockwise,
  cropOutputSize,
  cropTransform,
  fullCrop,
  maxCenteredRect,
  orientedSize,
  rectInside,
  straightenCrop,
} from './crop';
import type { Crop } from './recipe';

const map = (m: ReturnType<typeof cropTransform>, u: number, v: number) => {
  const r = applyMat3(m, [u, v, 1]);
  return [r[0], r[1]];
};
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
const crop = (over: Partial<Crop>): Crop => ({ ...fullCrop(), ...over });

describe('cropTransform', () => {
  it('sem recorte é a identidade', () => {
    const m = cropTransform(4000, 3000, undefined);
    close(map(m, 0, 0), [0, 0]);
    close(map(m, 1, 1), [1, 1]);
    close(map(m, 0.3, 0.7), [0.3, 0.7]);
  });

  it('recorte simples seleciona a região', () => {
    const m = cropTransform(4000, 3000, crop({ x: 0.5, y: 0.25, w: 0.5, h: 0.5 }));
    close(map(m, 0, 0), [0.5, 0.25]);
    close(map(m, 1, 1), [1, 0.75]);
  });

  it('um quarto de volta horário: o canto superior esquerdo vem do inferior esquerdo da fonte', () => {
    const m = cropTransform(4000, 3000, crop({ quarterTurns: 1 }));
    close(map(m, 0, 0), [0, 1]);
    close(map(m, 1, 0), [0, 0]);
    close(map(m, 1, 1), [1, 0]);
  });

  it('meia volta e três quartos', () => {
    close(map(cropTransform(4, 3, crop({ quarterTurns: 2 })), 0, 0), [1, 1]);
    close(map(cropTransform(4, 3, crop({ quarterTurns: 3 })), 0, 0), [1, 0]);
  });

  it('espelhar troca esquerda e direita', () => {
    const m = cropTransform(4000, 3000, crop({ flipH: true }));
    close(map(m, 0, 0), [1, 0]);
    close(map(m, 0.25, 0.5), [0.75, 0.5]);
  });

  it('endireitar gira em torno do centro, em pixels (não distorce)', () => {
    const W = 4000;
    const H = 3000;
    const c = straightenCrop(W, H, crop({}), 10);
    const m = cropTransform(W, H, c);
    close(map(m, 0.5, 0.5), [0.5, 0.5]);
    // a distância em pixels entre dois pontos se preserva
    const a = map(m, 0, 0.5);
    const b = map(m, 1, 0.5);
    const dist = Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H);
    expect(dist).toBeCloseTo(c.w * W, 3);
    // os cantos do recorte caem dentro da foto
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const p = map(m, u, v);
      expect(p[0]).toBeGreaterThanOrEqual(-1e-6);
      expect(p[0]).toBeLessThanOrEqual(1 + 1e-6);
      expect(p[1]).toBeGreaterThanOrEqual(-1e-6);
      expect(p[1]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe('tamanhos', () => {
  it('quartos de volta trocam largura e altura', () => {
    expect(orientedSize(4000, 3000, 1)).toEqual({ w: 3000, h: 4000 });
    expect(orientedSize(4000, 3000, 2)).toEqual({ w: 4000, h: 3000 });
  });

  it('tamanho de saída do recorte em pixels', () => {
    expect(cropOutputSize(4000, 3000, undefined)).toEqual({ w: 4000, h: 3000 });
    expect(cropOutputSize(4000, 3000, crop({ w: 0.5, h: 0.5 }))).toEqual({ w: 2000, h: 1500 });
    expect(cropOutputSize(4000, 3000, crop({ w: 0.5, h: 1, quarterTurns: 1 }))).toEqual({ w: 1500, h: 4000 });
  });
});

describe('maxCenteredRect / rectInside', () => {
  it('a 0° cabe a imagem inteira na proporção original', () => {
    const r = maxCenteredRect(4000, 3000, 0, 4 / 3);
    expect(r.w).toBeCloseTo(4000);
    expect(r.h).toBeCloseTo(3000);
  });

  it('com ângulo, o maior retângulo cabe e um pouco maior não', () => {
    const r = maxCenteredRect(4000, 3000, 7, 4 / 3);
    expect(r.w).toBeLessThan(4000);
    const rect = (k: number) => ({ x: 2000 - (r.w * k) / 2, y: 1500 - (r.h * k) / 2, w: r.w * k, h: r.h * k });
    expect(rectInside(4000, 3000, 7, rect(0.999))).toBe(true);
    expect(rectInside(4000, 3000, 7, rect(1.01))).toBe(false);
  });
});

describe('constrainCrop', () => {
  it('mantém o recorte dentro da foto endireitada, encolhendo em torno do centro', () => {
    const c = constrainCrop(4000, 3000, crop({ angle: 8, x: 0, y: 0, w: 1, h: 1 }));
    const px = { x: c.x * 4000, y: c.y * 3000, w: c.w * 4000, h: c.h * 3000 };
    expect(rectInside(4000, 3000, 8, { x: px.x + 0.5, y: px.y + 0.5, w: px.w - 1, h: px.h - 1 })).toBe(true);
    expect(c.x + c.w / 2).toBeCloseTo(0.5);
    expect(c.w / c.h).toBeCloseTo(1, 1); // proporção normalizada preservada
  });

  it('não mexe num recorte válido', () => {
    const c = crop({ x: 0.1, y: 0.2, w: 0.3, h: 0.3 });
    expect(constrainCrop(4000, 3000, c)).toEqual(c);
  });

  it('impõe tamanho mínimo', () => {
    const c = constrainCrop(4000, 3000, crop({ w: 0, h: 0 }));
    expect(c.w * 4000).toBeGreaterThanOrEqual(32);
  });
});

describe('straightenCrop', () => {
  it('ao endireitar, o recorte vira o maior retângulo centrado com a mesma proporção', () => {
    const c = straightenCrop(4000, 3000, crop({ x: 0, y: 0, w: 1, h: 1 }), 5);
    expect(c.angle).toBe(5);
    expect((c.w * 4000) / (c.h * 3000)).toBeCloseTo(4 / 3, 6);
    expect(c.x + c.w / 2).toBeCloseTo(0.5);
  });

  it('voltar a 0° recupera a imagem inteira', () => {
    const c = straightenCrop(4000, 3000, straightenCrop(4000, 3000, crop({}), 12), 0);
    expect(c.w).toBeCloseTo(1);
    expect(c.h).toBeCloseTo(1);
  });
});

describe('girar e espelhar mantêm a região recortada', () => {
  const corners = (c: Crop) =>
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]
      .map(([u, v]) => map(cropTransform(4000, 3000, c), u, v).map((x) => Math.round(x * 1e6) / 1e6).join(','))
      .sort();
  const base = crop({ x: 0.1, y: 0.2, w: 0.5, h: 0.3, angle: 0 });

  it('girar 90° mostra os mesmos cantos da fonte', () => {
    expect(corners(rotateCropClockwise(base))).toEqual(corners(base));
  });

  it('quatro giros voltam ao início', () => {
    let c = base;
    for (let i = 0; i < 4; i++) c = rotateCropClockwise(c);
    expect(c.quarterTurns).toBe(0);
    [c.x, c.y, c.w, c.h].forEach((v, i) => expect(v).toBeCloseTo([base.x, base.y, base.w, base.h][i], 9));
  });

  it('espelhar mostra os mesmos cantos da fonte', () => {
    expect(corners(flipCrop(base))).toEqual(corners(base));
  });
});

describe('fitTowards', () => {
  it('aceita o destino quando ele cabe', () => {
    const from = crop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    const to = crop({ x: 0.1, y: 0.1, w: 0.6, h: 0.5 });
    expect(fitTowards(4000, 3000, from, to)).toEqual(to);
  });

  it('para na borda quando o destino sai da foto', () => {
    const from = crop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    const to = crop({ x: 0.1, y: 0.1, w: 1.2, h: 0.5 });
    const out = fitTowards(4000, 3000, from, to);
    expect(out.x + out.w).toBeCloseTo(1, 4);
    expect(cropFits(4000, 3000, out)).toBe(true);
  });

  it('respeita o ângulo de endireitamento', () => {
    const from = straightenCrop(4000, 3000, crop({}), 10);
    const to = { ...from, w: from.w + 0.2 };
    expect(cropFits(4000, 3000, fitTowards(4000, 3000, from, to))).toBe(true);
  });
});
