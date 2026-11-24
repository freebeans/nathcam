/** Estado da biblioteca na interface: lista, importação, seleção e exclusão. */
import type { Library, PhotoRecord } from './library';
import { SOURCE_MAX_SIDE, decodeImage, exifSummaryOf, thumbFromBitmap } from './photo';

export class Gallery {
  photos = $state.raw<PhotoRecord[]>([]);
  selecting = $state(false);
  selected = $state.raw<ReadonlySet<string>>(new Set());
  importing = $state(0);
  error = $state<string | null>(null);

  constructor(
    readonly library: Library,
    private maxTextureSize: () => number,
  ) {}

  async refresh(): Promise<void> {
    try {
      this.photos = await this.library.listPhotos();
    } catch (e) {
      // Ex.: navegação privada ou armazenamento cheio/bloqueado.
      this.error = `Armazenamento local indisponível: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** Importa arquivos para a biblioteca; devolve os ids criados, na ordem. */
  async import(files: File[]): Promise<string[]> {
    const ids: string[] = [];
    const errors: string[] = [];
    this.importing = files.length;
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const bmp = await decodeImage(new Blob([bytes], { type: f.type }), f.name, Math.min(SOURCE_MAX_SIDE, this.maxTextureSize()));
        try {
          const id = await this.library.addPhoto({
            name: f.name,
            type: f.type || 'image/jpeg',
            bytes,
            width: bmp.width,
            height: bmp.height,
            thumb: await thumbFromBitmap(bmp),
            exif: exifSummaryOf(bytes),
          });
          ids.push(id);
        } finally {
          bmp.close();
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      this.importing--;
    }
    this.error = errors.length ? errors.join('\n') : null;
    await this.refresh();
    return ids;
  }

  toggle(id: string): void {
    const s = new Set(this.selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.selected = s;
  }

  setSelecting(on: boolean): void {
    this.selecting = on;
    this.selected = new Set();
  }

  async deleteSelected(): Promise<void> {
    await this.library.deletePhotos([...this.selected]);
    this.setSelecting(false);
    await this.refresh();
  }
}
