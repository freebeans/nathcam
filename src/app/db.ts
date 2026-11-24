/**
 * Banco local (IndexedDB via Dexie). Ver PRD, "Dados e armazenamento".
 * Tratado como descartável: o iOS pode apagá-lo; presets locais têm backup.
 */
import Dexie, { type Table } from 'dexie';
import type { PresetRecipe } from '../engine/recipe';
import type { HistoryRecord, PhotoRecord, RecipeRecord } from './library';

/** LUT local em binário (Float32), não em texto. */
export interface LutRecord {
  id: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: ArrayBuffer;
}

export interface PresetRecord extends PresetRecipe {
  createdAt: number;
}

/** Preferências de organização: id `preset:<id>` ou `pack:<nome>`. */
export interface PresetMetaRecord {
  id: string;
  favorite?: boolean;
  hidden?: boolean;
}

export class Db extends Dexie {
  photos!: Table<PhotoRecord, string>;
  recipes!: Table<RecipeRecord, string>;
  history!: Table<HistoryRecord, string>;
  presets!: Table<PresetRecord, string>;
  luts!: Table<LutRecord, string>;
  presetMeta!: Table<PresetMetaRecord, string>;

  constructor(name = 'nathcam') {
    super(name);
    this.version(1).stores({
      photos: 'id, importedAt',
      recipes: 'photoId',
      history: 'photoId',
    });
    this.version(2).stores({
      presets: 'id, pack, createdAt',
      luts: 'id',
      presetMeta: 'id',
    });
  }
}
