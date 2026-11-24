import type { PartialParams } from './params';

export type LutColorSpace = 'srgb' | 'display-p3';

export interface PresetLut {
  src: string;
  colorSpace: LutColorSpace;
}

/**
 * Receita de um preset já resolvida (sem `extends`): é o que uma foto guarda
 * como cópia do preset aplicado.
 */
export interface PresetRecipe {
  id: string;
  name: string;
  pack: string;
  params: PartialParams;
  lut?: PresetLut | null;
  engineVersion: number;
}

export interface Crop {
  /** Retângulo em coordenadas normalizadas (0..1) da imagem já endireitada. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Endireitamento em graus. */
  angle: number;
  /** Rotações de 90° no sentido horário (0..3). */
  quarterTurns: number;
  flipH: boolean;
}

/** Estado completo de edição de uma foto. */
export interface Recipe {
  engineVersion: number;
  preset: PresetRecipe | null;
  /** 0..1 */
  intensity: number;
  /** Camada do usuário: deslocamentos relativos ao neutro, somados sobre o preset. */
  user: PartialParams;
  crop?: Crop;
}
