#!/usr/bin/env node
/**
 * Baixa a coleção de emulação de filme dos color presets do G'MIC e grava os
 * filtros escolhidos como presets oficiais (public/luts/gmic e
 * public/presets/gmic-*.json). Script único, fora do app.
 *
 * Licença: a coleção (filmes negativos, P&B, slide, instantâneos e filmes
 * de cópia) é distribuída sob CC BY-SA 4.0. Exceção: o pack "fuji" (Fuji
 * X-Trans III) não tem licença declarada e só está aqui porque o
 * repositório é privado e de uso pessoal — ver https://github.com/cyangraphics/clut
 * e public/licenses/gmic-clut-CC-BY-SA-4.0.txt. Os .cube gravados aqui são
 * obras derivadas sob a mesma licença. Nomes de filmes e marcas são só
 * informativos: indicam qual filme cada LUT aproxima.
 *
 * Uso: npm run fetch:gmic
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const lutDir = join(root, 'public', 'luts', 'gmic');
const presetDir = join(root, 'public', 'presets');
const BASE = 'https://gmic.eu/color_presets';

/** [pack exibido como aba, categoria do G'MIC, [arquivo, nome exibido][]] — na ordem das abas. */
const PACKS = [
  [
    'filme',
    [
      ['negative_new', 'kodak_portra_160', 'Portra 160'],
      ['negative_new', 'kodak_portra_400', 'Portra 400'],
      ['negative_new', 'kodak_portra_800', 'Portra 800'],
      ['negative_new', 'kodak_portra_800_hc', 'Portra 800 HC'],
      ['negative_old', 'kodak_portra_160_nc', 'Portra 160 NC'],
      ['negative_old', 'kodak_portra_160_vc', 'Portra 160 VC'],
      ['negative_old', 'kodak_portra_400_nc', 'Portra 400 NC'],
      ['negative_old', 'kodak_portra_400_vc', 'Portra 400 VC'],
      ['negative_old', 'kodak_portra_400_uc', 'Portra 400 UC'],
      ['negative_new', 'fuji_400h', 'Fuji 400H'],
      ['negative_new', 'fuji_160c', 'Fuji 160C'],
      ['negative_new', 'fuji_800z', 'Fuji 800Z'],
      ['negative_color', 'kodak_ektar_100', 'Ektar 100'],
      ['negative_color', 'kodak_elite_color_200', 'Elite Color 200'],
      ['negative_color', 'kodak_elite_color_400', 'Elite Color 400'],
      ['negative_old', 'fuji_superia_100', 'Superia 100'],
      ['negative_old', 'fuji_superia_400', 'Superia 400'],
      ['negative_old', 'fuji_superia_800', 'Superia 800'],
      ['negative_old', 'fuji_superia_1600', 'Superia 1600'],
      ['negative_color', 'fuji_superia_reala_100', 'Superia Reala 100'],
      ['negative_color', 'fuji_superia_x-tra_800', 'Superia X-tra 800'],
      ['negative_color', 'agfa_vista_200', 'Agfa Vista 200'],
      ['negative_color', 'agfa_ultra_color_100', 'Agfa Ultra 100'],
      ['negative_color', 'lomography_redscale_100', 'Lomo Redscale 100'],
    ],
  ],
  [
    'filme ±',
    ['kodak_portra_160:Portra 160', 'kodak_portra_400:Portra 400', 'kodak_portra_800:Portra 800', 'fuji_400h:Fuji 400H', 'fuji_160c:Fuji 160C'].flatMap(
      (s) => {
        const [f, n] = s.split(':');
        return [
          ['negative_new', `${f}_-`, `${n} −`],
          ['negative_new', `${f}_+`, `${n} +`],
          ['negative_new', `${f}_++`, `${n} ++`],
        ];
      },
    ),
  ],
  [
    'p&b',
    [
      ['bw', 'kodak_tri-x_400', 'Tri-X 400'],
      ['bw', 'ilford_hp_5_plus_400', 'HP5 Plus 400'],
      ['bw', 'ilford_delta_100', 'Delta 100'],
      ['bw', 'ilford_delta_400', 'Delta 400'],
      ['bw', 'ilford_delta_3200', 'Delta 3200'],
      ['bw', 'ilford_fp_4_plus_125', 'FP4 Plus 125'],
      ['bw', 'ilford_pan_f_plus_50', 'Pan F Plus 50'],
      ['bw', 'ilford_xp_2', 'XP2'],
      ['bw', 'fuji_neopan_acros_100', 'Acros 100'],
      ['bw', 'fuji_neopan_1600', 'Neopan 1600'],
      ['bw', 'kodak_t-max_100', 'T-Max 100'],
      ['bw', 'kodak_t-max_400', 'T-Max 400'],
      ['bw', 'kodak_t-max_3200', 'T-Max 3200'],
      ['bw', 'kodak_bw_400_cn', 'BW 400 CN'],
      ['bw', 'agfa_apx_100', 'Agfa APX 100'],
      ['bw', 'rollei_retro_100_tonal', 'Rollei Retro 100'],
    ],
  ],
  [
    'slide',
    [
      ['colorslide', 'fuji_velvia_50', 'Velvia 50'],
      ['colorslide', 'fuji_provia_100f', 'Provia 100F'],
      ['colorslide', 'fuji_astia_100f', 'Astia 100F'],
      ['colorslide', 'fuji_provia_400x', 'Provia 400X'],
      ['colorslide', 'kodak_kodachrome_25', 'Kodachrome 25'],
      ['colorslide', 'kodak_kodachrome_64', 'Kodachrome 64'],
      ['colorslide', 'kodak_kodachrome_200', 'Kodachrome 200'],
      ['colorslide', 'kodak_ektachrome_100_vs', 'Ektachrome 100 VS'],
      ['colorslide', 'kodak_e-100_gx_ektachrome_100', 'Ektachrome E100GX'],
      ['colorslide', 'kodak_elite_chrome_200', 'Elite Chrome 200'],
      ['colorslide', 'agfa_precisa_100', 'Agfa Precisa 100'],
      ['colorslide', 'lomography_x-pro_slide_200', 'Lomo X-Pro 200'],
      ['colorslide', 'fuji_superia_200_xpro', 'Superia 200 X-Pro'],
      ['negative_color', 'kodak_elite_100_xpro', 'Elite 100 X-Pro'],
    ],
  ],
  [
    'instantâneo',
    [
      ['instant_pro', 'polaroid_690', 'Polaroid 690'],
      ['instant_pro', 'polaroid_690_warm', 'Polaroid 690 Quente'],
      ['instant_pro', 'polaroid_690_cold', 'Polaroid 690 Frio'],
      ['instant_pro', 'polaroid_669', 'Polaroid 669'],
      ['instant_pro', 'polaroid_669_cold', 'Polaroid 669 Frio'],
      ['instant_pro', 'polaroid_665', 'Polaroid 665'],
      ['instant_pro', 'fuji_fp-100c', 'Fuji FP-100C'],
      ['instant_pro', 'fuji_fp-100c_cool', 'Fuji FP-100C Frio'],
      ['instant_pro', 'fuji_fp-3000b', 'Fuji FP-3000B'],
      ['instant_consumer', 'polaroid_px-70', 'Polaroid PX-70'],
      ['instant_consumer', 'polaroid_px-70_warm', 'Polaroid PX-70 Quente'],
      ['instant_consumer', 'polaroid_px-680', 'Polaroid PX-680'],
      ['instant_consumer', 'polaroid_px-100uv+_warm', 'Polaroid PX-100 Quente'],
      ['instant_consumer', 'polaroid_px-100uv+_cold', 'Polaroid PX-100 Frio'],
      ['instant_consumer', 'polaroid_time_zero_expired', 'Time Zero Vencido'],
      ['colorslide', 'polaroid_polachrome', 'Polachrome'],
    ],
  ],
  [
    'fuji',
    [
      ['fujixtransiii', 'fuji_xtrans_iii_classic_chrome', 'Classic Chrome'],
      ['fujixtransiii', 'fuji_xtrans_iii_pro_neg_hi', 'Pro Neg Hi'],
      ['fujixtransiii', 'fuji_xtrans_iii_pro_neg_std', 'Pro Neg Std'],
      ['fujixtransiii', 'fuji_xtrans_iii_astia', 'Astia'],
      ['fujixtransiii', 'fuji_xtrans_iii_provia', 'Provia'],
      ['fujixtransiii', 'fuji_xtrans_iii_velvia', 'Velvia'],
      ['fujixtransiii', 'fuji_xtrans_iii_acros', 'Acros'],
      ['fujixtransiii', 'fuji_xtrans_iii_acros+r', 'Acros + R'],
      ['fujixtransiii', 'fuji_xtrans_iii_acros+ye', 'Acros + Ye'],
      ['fujixtransiii', 'fuji_xtrans_iii_acros+g', 'Acros + G'],
      ['fujixtransiii', 'fuji_xtrans_iii_mono', 'Mono'],
      ['fujixtransiii', 'fuji_xtrans_iii_sepia', 'Sépia'],
    ],
  ],
  [
    'cinema',
    [
      ['print', 'kodak_2383_constlmap', 'Kodak 2383'],
      ['print', 'kodak_2393_constlmap', 'Kodak 2393'],
      ['print', 'fuji_3510_constlmap', 'Fuji 3510'],
      ['print', 'fuji_3513_constlmap', 'Fuji 3513'],
    ],
  ],
];

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/±/g, 'mais-menos')
    .replace(/&/g, 'e')
    .replace(/−/g, 'menos')
    .replace(/\+/g, 'mais')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const HEADER = [
  "# Fonte: color presets do G'MIC (https://gmic.eu/color_presets/), coleção também em",
  '# https://github.com/cyangraphics/clut — licença CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).',
  '# Nome do filme apenas informativo (indica o que a LUT aproxima). Gerado por scripts/gmic/fetch.mjs.',
];

/** Categorias sem licença declarada na origem: incluídas só porque o repositório é de uso pessoal. */
const PERSONAL_USE = new Set(['fujixtransiii']);
const PERSONAL_HEADER = [
  "# Fonte: color presets do G'MIC (https://gmic.eu/color_presets/), categoria Fuji X-Trans III.",
  '# A origem não declara licença: incluído apenas para uso pessoal (repositório privado). Não redistribuir.',
  '# Nome do filme apenas informativo (indica o que a LUT aproxima). Gerado por scripts/gmic/fetch.mjs.',
];

async function download(cat) {
  const url = `${BASE}/${cat}/${cat}_cube.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return unzipSync(new Uint8Array(await res.arrayBuffer()), { filter: (f) => f.name.endsWith('.cube') && f.originalSize < 4e6 });
}

// Recomeça do zero: apaga o que este script gerou antes.
rmSync(lutDir, { recursive: true, force: true });
for (const f of readdirSync(presetDir)) if (f.startsWith('gmic-')) rmSync(join(presetDir, f));
mkdirSync(lutDir, { recursive: true });

const cats = new Map();
let total = 0;
for (let p = 0; p < PACKS.length; p++) {
  const [pack, list] = PACKS[p];
  for (let i = 0; i < list.length; i++) {
    const [cat, file, name] = list[i];
    if (!cats.has(cat)) cats.set(cat, await download(cat));
    const entry = Object.entries(cats.get(cat)).find(([k]) => k.split('/').pop() === `${file}.cube`);
    if (!entry) throw new Error(`${cat}/${file}.cube não está no pacote`);
    const text = strFromU8(entry[1]);
    const size = Number(text.match(/^LUT_3D_SIZE\s+(\d+)/m)?.[1]);
    const rows = text.split(/\r?\n/).filter((l) => /^\s*[-\d.]/.test(l)).length;
    if (!size || rows !== size ** 3) throw new Error(`${file}: .cube inválido (${size}, ${rows} linhas)`);
    const id = `gmic-${slug(pack)}-${slug(name)}`;
    // 4 casas decimais (erro < 0,0001, invisível) para metade do tamanho.
    const body = text
      .replace(/^TITLE .*$/m, `TITLE "${name}"`)
      .replace(/^\s*(-?[\d.]+(?:e-?\d+)?)\s+(-?[\d.]+(?:e-?\d+)?)\s+(-?[\d.]+(?:e-?\d+)?)\s*$/gim, (_, r, g, b) =>
        [r, g, b].map((v) => Number(Number(v).toFixed(4)).toString()).join(' '),
      );
    writeFileSync(join(lutDir, `${id}.cube`), [...(PERSONAL_USE.has(cat) ? PERSONAL_HEADER : HEADER), body].join('\n'));
    // Prefixo numérico: ordem das abas e dos presets dentro do pack.
    const fname = `gmic-${p + 1}-${String(i + 1).padStart(2, '0')}-${slug(name)}.json`;
    const preset = { id, name, pack, extends: null, params: {}, lut: { src: `luts/gmic/${id}.cube`, colorSpace: 'srgb' }, engineVersion: 1 };
    writeFileSync(join(presetDir, fname), JSON.stringify(preset, null, 2) + '\n');
    total++;
  }
  console.log(`${pack}: ${list.length}`);
}
console.log(`total: ${total}`);
