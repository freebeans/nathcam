import { describe, expect, it } from 'vitest';
import { parseCube, serializeCube } from './cube';

const tiny = `# comentário
TITLE "Teste"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1

0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

describe('parseCube', () => {
  it('lê tamanho, título e dados com o vermelho variando mais rápido', () => {
    const lut = parseCube(tiny);
    expect(lut.size).toBe(2);
    expect(lut.title).toBe('Teste');
    expect(lut.data.length).toBe(2 * 2 * 2 * 3);
    expect(Array.from(lut.data.slice(3, 6))).toEqual([1, 0, 0]);
    expect(Array.from(lut.data.slice(6, 9))).toEqual([0, 1, 0]);
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it('aceita CRLF, notação científica e domínio padrão', () => {
    const src = 'LUT_3D_SIZE 2\r\n' + Array(8).fill('1e-1 0.5 1.0E0').join('\r\n');
    const lut = parseCube(src);
    expect(lut.data[0]).toBeCloseTo(0.1);
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it('acusa quantidade errada de linhas', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow(/8/);
  });

  it('acusa LUT 1D ou sem tamanho', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0')).toThrow(/3D/);
  });

  it('acusa números inválidos', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n' + Array(8).fill('a b c').join('\n'))).toThrow(/inválid/);
  });

  it('ida e volta com serializeCube', () => {
    const lut = parseCube(tiny);
    const again = parseCube(serializeCube(lut));
    expect(Array.from(again.data)).toEqual(Array.from(lut.data));
    expect(again.title).toBe('Teste');
  });
});
