/** LUT 3D lida de um arquivo `.cube` (formato Adobe/Resolve). */
export interface Lut3D {
  title?: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** RGB float, índice = r + g*N + b*N*N (vermelho varia mais rápido). */
  data: Float32Array;
}

const MAX_SIZE = 129;

export function parseCube(text: string): Lut3D {
  let size = 0;
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let data: Float32Array | null = null;
  let n = 0;

  const triple = (parts: string[], line: number): [number, number, number] => {
    const v = parts.slice(0, 3).map(Number);
    if (parts.length < 3 || v.some((x) => !Number.isFinite(x))) throw new Error(`.cube: valor inválido na linha ${line}`);
    return v as [number, number, number];
  };

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') {
      title = line.slice(5).trim().replace(/^"|"$/g, '');
    } else if (key === 'LUT_3D_SIZE') {
      size = Number(parts[1]);
      if (!Number.isInteger(size) || size < 2 || size > MAX_SIZE) throw new Error(`.cube: tamanho inválido ${parts[1]}`);
      data = new Float32Array(size * size * size * 3);
    } else if (key === 'LUT_1D_SIZE') {
      throw new Error('.cube: só LUTs 3D são suportadas');
    } else if (key === 'DOMAIN_MIN') {
      domainMin = triple(parts.slice(1), i + 1);
    } else if (key === 'DOMAIN_MAX') {
      domainMax = triple(parts.slice(1), i + 1);
    } else if (/^[A-Z][A-Z0-9_]*$/.test(parts[0])) {
      // Palavra-chave desconhecida (ex.: LUT_3D_INPUT_RANGE): ignora.
      continue;
    } else {
      if (!data) throw new Error('.cube: LUT_3D_SIZE ausente (só LUTs 3D são suportadas)');
      const v = triple(parts, i + 1);
      if (n >= size * size * size) throw new Error(`.cube: linhas demais (esperado ${size ** 3})`);
      data[n * 3] = v[0];
      data[n * 3 + 1] = v[1];
      data[n * 3 + 2] = v[2];
      n++;
    }
  }
  if (!data) throw new Error('.cube: LUT_3D_SIZE ausente (só LUTs 3D são suportadas)');
  if (n !== size * size * size) throw new Error(`.cube: esperado ${size ** 3} linhas de dados, encontrado ${n}`);
  return { title, size, domainMin, domainMax, data };
}

export function serializeCube(lut: Lut3D): string {
  const out: string[] = [];
  if (lut.title) out.push(`TITLE "${lut.title}"`);
  out.push(`LUT_3D_SIZE ${lut.size}`);
  out.push(`DOMAIN_MIN ${lut.domainMin.join(' ')}`);
  out.push(`DOMAIN_MAX ${lut.domainMax.join(' ')}`);
  const f = (v: number) => (Math.round(v * 1e6) / 1e6).toString();
  for (let i = 0; i < lut.data.length; i += 3) out.push(`${f(lut.data[i])} ${f(lut.data[i + 1])} ${f(lut.data[i + 2])}`);
  return out.join('\n') + '\n';
}
