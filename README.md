# nathcam

Editor de fotos PWA centrado em presets, 100% front-end. Especificação: [`docs/prd-editor-de-fotos-pwa.md`](docs/prd-editor-de-fotos-pwa.md).

```bash
npm install
npm run dev          # servidor de desenvolvimento
npm run build        # site estático em dist/
npm run check        # svelte-check / TypeScript
npm test             # testes unitários + motor no Chromium headless
npm run e2e          # ponta a ponta contra o build (rode npm run build antes)
npm run refs:update  # regenera as imagens de referência do motor (mudança intencional no shader)
npm run convert:cssco  # regenera public/luts e public/presets a partir do cssco
npm run fetch:gmic   # baixa e regenera as emulações de filme do G'MIC (public/luts/gmic)
```

Estrutura:

- `src/engine/`: motor WebGL2 (TypeScript + GLSL, sem dependência da interface). A ordem do pipeline mora em `src/engine/pipeline.ts`.
- `src/export/`: codificação JPEG (MozJPEG/WASM num worker), perfil ICC Display P3, EXIF.
- `src/presets/`: formato de preset e herança (`extends`).
- `src/app/`: estado do editor e carregamento de fotos/presets.
- `src/ui/`: interface Svelte 5.
- `public/presets`, `public/luts`: presets oficiais; `presets/manifest.json` é gerado no build.

Os presets do cssco são MIT, © 2016 Lauren Waller (ver `public/luts/LICENSE-cssco.txt`). As emulações de filme (packs filme, filme ±, p&b, slide, instantâneo, fuji e cinema) vêm da coleção de color presets do [G'MIC](https://gmic.eu/color_presets/) ([também em cyangraphics/clut](https://github.com/cyangraphics/clut)), sob [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); ver `public/licenses/gmic-clut-CC-BY-SA-4.0.txt`. Exceção: o pack fuji (Fuji X-Trans III) não tem licença declarada e só está aqui porque o repositório é privado e de uso pessoal. Nomes de filmes e fabricantes são marcas de seus donos, usados só para indicar o que cada LUT aproxima.

HEIC em navegadores sem suporte nativo usa o [libheif](https://github.com/strukturag/libheif) (LGPL-3.0, com o decodificador HEVC libde265, também LGPL) compilado para WASM pelo [libheif-js](https://github.com/catdad-experiments/libheif-js), sem modificações, carregado como um módulo separado que pode ser substituído. As licenças vão junto no site publicado, em `public/licenses/`. A codificação JPEG usa MozJPEG via [jSquash](https://github.com/jamsinclair/jSquash).
