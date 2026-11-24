/** Histórico de edição de uma foto: desfazer/refazer, persistível. */

export const HISTORY_LIMIT = 100;

export interface HistorySnapshot<T> {
  entries: T[];
  index: number;
}

export class History<T> {
  private entries: T[];
  private index: number;
  /** Controle do último passo, enquanto ele ainda pode absorver o próximo. */
  private lastKey: string | null = null;

  constructor(initial: T) {
    this.entries = [initial];
    this.index = 0;
  }

  static restore<T>(snap: HistorySnapshot<T>, fallback?: T): History<T> {
    const ok = snap && Array.isArray(snap.entries) && snap.entries.length > 0 && snap.index >= 0 && snap.index < snap.entries.length;
    if (!ok) return new History(fallback as T);
    const h = new History(snap.entries[0]);
    h.entries = snap.entries.slice(-HISTORY_LIMIT);
    h.index = Math.min(snap.index - (snap.entries.length - h.entries.length), h.entries.length - 1);
    if (h.index < 0) h.index = 0;
    return h;
  }

  get current(): T {
    return this.entries[this.index];
  }
  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }
  get length(): number {
    return this.entries.length;
  }

  /**
   * Registra um estado novo. Passos seguidos com a mesma `key` (o mesmo
   * slider sendo arrastado) substituem o anterior em vez de empilhar.
   */
  push(state: T, key?: string): void {
    const atTop = !this.canRedo;
    if (key && key === this.lastKey && atTop && this.index > 0) {
      this.entries[this.index] = state;
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(state);
    if (this.entries.length > HISTORY_LIMIT) this.entries = this.entries.slice(-HISTORY_LIMIT);
    this.index = this.entries.length - 1;
    this.lastKey = key ?? null;
  }

  undo(): T {
    if (this.canUndo) this.index--;
    this.lastKey = null;
    return this.current;
  }

  redo(): T {
    if (this.canRedo) this.index++;
    this.lastKey = null;
    return this.current;
  }

  snapshot(): HistorySnapshot<T> {
    return { entries: this.entries.slice(), index: this.index };
  }
}
