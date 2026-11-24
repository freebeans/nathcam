/**
 * Biblioteca local no IndexedDB (ver PRD, "Dados e armazenamento").
 * É uma área de trabalho: o original continua no rolo da câmera, e o iOS
 * pode apagar estes dados.
 */
import Dexie, { type Table } from 'dexie';
import type { Recipe } from '../engine/recipe';
import type { ExifSummary } from '../export/exif';
import type { HistorySnapshot } from './history';
import { emptyRecipe } from './recipe-edit';

export interface PhotoRecord {
  id: string;
  name: string;
  type: string;
  /** Cópia do arquivo original. */
  original: Blob;
  /** Miniatura com a edição atual (JPEG pequeno). */
  thumb: Blob | null;
  width: number;
  height: number;
  exif: ExifSummary;
  importedAt: number;
  editedAt?: number;
}

export interface RecipeRecord {
  photoId: string;
  recipe: Recipe;
  updatedAt: number;
}

export interface HistoryRecord {
  photoId: string;
  snapshot: HistorySnapshot<Recipe>;
}

export interface NewPhoto {
  name: string;
  type: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  thumb: Blob | null;
  exif: ExifSummary;
}

export interface Edit {
  recipe: Recipe;
  history: HistorySnapshot<Recipe>;
}

class Db extends Dexie {
  photos!: Table<PhotoRecord, string>;
  recipes!: Table<RecipeRecord, string>;
  history!: Table<HistoryRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      photos: 'id, importedAt',
      recipes: 'photoId',
      history: 'photoId',
    });
  }
}

export class Library {
  private db: Db;

  constructor(name = 'nathcam') {
    this.db = new Db(name);
  }

  async addPhoto(p: NewPhoto): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.photos.add({
      id,
      name: p.name,
      type: p.type,
      original: new Blob([p.bytes as Uint8Array<ArrayBuffer>], { type: p.type }),
      thumb: p.thumb,
      width: p.width,
      height: p.height,
      exif: p.exif,
      importedAt: Date.now(),
    });
    return id;
  }

  /** Fotos da mais recente para a mais antiga. */
  async listPhotos(): Promise<PhotoRecord[]> {
    return this.db.photos.orderBy('importedAt').reverse().toArray();
  }

  getPhoto(id: string): Promise<PhotoRecord | undefined> {
    return this.db.photos.get(id);
  }

  async loadEdit(id: string): Promise<Edit> {
    const [r, h] = await Promise.all([this.db.recipes.get(id), this.db.history.get(id)]);
    const recipe = r?.recipe ?? emptyRecipe();
    return { recipe, history: h?.snapshot ?? { entries: [recipe], index: 0 } };
  }

  /** Grava a receita atual, o histórico e (se dada) a miniatura editada, numa transação. */
  async saveEdit(id: string, recipe: Recipe, history: HistorySnapshot<Recipe>, thumb?: Blob): Promise<void> {
    const now = Date.now();
    await this.db.transaction('rw', this.db.photos, this.db.recipes, this.db.history, async () => {
      await this.db.recipes.put({ photoId: id, recipe, updatedAt: now });
      await this.db.history.put({ photoId: id, snapshot: history });
      await this.db.photos.update(id, thumb ? { editedAt: now, thumb } : { editedAt: now });
    });
  }

  async deletePhotos(ids: string[]): Promise<void> {
    await this.db.transaction('rw', this.db.photos, this.db.recipes, this.db.history, async () => {
      await this.db.photos.bulkDelete(ids);
      await this.db.recipes.bulkDelete(ids);
      await this.db.history.bulkDelete(ids);
    });
  }

  /** Apaga o banco inteiro (testes). */
  async destroy(): Promise<void> {
    await this.db.delete();
  }
}
