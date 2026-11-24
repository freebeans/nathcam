/** Organização dos presets na interface: packs como abas, favoritos, ocultos e busca. */
import type { PresetRecipe } from '../engine/recipe';

export interface PresetItem {
  preset: PresetRecipe;
  /** Preset do aparelho (editável); falso = oficial, somente leitura. */
  local: boolean;
}

export interface PresetPrefs {
  favorites: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  hiddenPacks: ReadonlySet<string>;
}

export interface Organized {
  packs: string[];
  byPack: Record<string, PresetItem[]>;
  /** Resultados da busca (todos os packs), ou null sem busca. */
  search: PresetItem[] | null;
}

/** Pack padrão dos presets criados no aparelho. */
export const MY_PACK = 'meus';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function organize(
  items: readonly PresetItem[],
  prefs: PresetPrefs,
  opts: { packOrder?: readonly string[]; query?: string; showHidden?: boolean } = {},
): Organized {
  const visible = items.filter(
    (i) => opts.showHidden || (!prefs.hidden.has(i.preset.id) && !prefs.hiddenPacks.has(i.preset.pack)),
  );
  const favFirst = (xs: PresetItem[]) => [
    ...xs.filter((x) => prefs.favorites.has(x.preset.id)),
    ...xs.filter((x) => !prefs.favorites.has(x.preset.id)),
  ];

  const byPack: Record<string, PresetItem[]> = {};
  for (const i of visible) (byPack[i.preset.pack] ??= []).push(i);
  for (const k of Object.keys(byPack)) byPack[k] = favFirst(byPack[k]);

  const order = opts.packOrder ?? [];
  const rank = (pack: string) => {
    const i = order.indexOf(pack);
    if (i >= 0) return [0, i] as const;
    return pack === MY_PACK ? ([1, 0] as const) : ([2, 0] as const);
  };
  const packs = Object.keys(byPack).sort((a, b) => {
    const [ra, ia] = rank(a);
    const [rb, ib] = rank(b);
    return ra - rb || ia - ib || a.localeCompare(b, 'pt-BR');
  });

  const q = fold(opts.query?.trim() ?? '');
  const search = q ? favFirst(visible.filter((i) => fold(i.preset.name).includes(q))) : null;
  return { packs, byPack, search };
}
