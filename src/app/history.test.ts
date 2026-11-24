import { describe, expect, it } from 'vitest';
import { History, HISTORY_LIMIT } from './history';

describe('History', () => {
  it('começa no estado inicial, sem desfazer nem refazer', () => {
    const h = new History('a');
    expect(h.current).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('desfaz e refaz', () => {
    const h = new History('a');
    h.push('b', 'exposure');
    h.push('c', 'contrast');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBe('a');
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.canRedo).toBe(false);
  });

  it('passos seguidos no mesmo controle viram um só', () => {
    const h = new History(0);
    h.push(1, 'exposure');
    h.push(2, 'exposure');
    h.push(3, 'exposure');
    expect(h.length).toBe(2);
    expect(h.undo()).toBe(0);
  });

  it('um controle diferente no meio quebra a fusão', () => {
    const h = new History(0);
    h.push(1, 'exposure');
    h.push(2, 'contrast');
    h.push(3, 'exposure');
    expect(h.length).toBe(4);
  });

  it('passos sem chave nunca se fundem', () => {
    const h = new History(0);
    h.push(1);
    h.push(2);
    expect(h.length).toBe(3);
  });

  it('não funde depois de um desfazer (o passo refeito não é sobrescrito)', () => {
    const h = new History(0);
    h.push(1, 'exposure');
    h.push(2, 'contrast');
    h.undo();
    h.push(5, 'exposure');
    expect(h.length).toBe(3);
    expect(h.undo()).toBe(1);
  });

  it('um passo novo depois de desfazer descarta o futuro', () => {
    const h = new History('a');
    h.push('b');
    h.push('c');
    h.undo();
    h.push('d');
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('b');
  });

  it(`guarda no máximo ${HISTORY_LIMIT} passos, descartando os mais antigos`, () => {
    const h = new History(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h.push(i);
    expect(h.length).toBe(HISTORY_LIMIT);
    let last = h.current;
    while (h.canUndo) last = h.undo();
    expect(last).toBe(21);
  });

  it('serializa e restaura', () => {
    const h = new History({ v: 1 });
    h.push({ v: 2 }, 'x');
    h.push({ v: 3 }, 'y');
    h.undo();
    const r = History.restore(JSON.parse(JSON.stringify(h.snapshot())));
    expect(r.current).toEqual({ v: 2 });
    expect(r.redo()).toEqual({ v: 3 });
    // a fusão não atravessa uma restauração
    const r2 = History.restore(h.snapshot());
    r2.redo();
    r2.push({ v: 4 }, 'y');
    expect(r2.length).toBe(4);
  });

  it('restaurar um snapshot inválido volta ao estado dado', () => {
    const r = History.restore({ entries: [], index: 3 } as never, 'fallback');
    expect(r.current).toBe('fallback');
  });
});
