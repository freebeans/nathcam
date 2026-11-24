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
```

Estrutura:

- `src/engine/`: motor WebGL2 (TypeScript + GLSL, sem dependência da interface). A ordem do pipeline mora em `src/engine/pipeline.ts`.
- `src/export/`: codificação JPEG (MozJPEG/WASM num worker), perfil ICC Display P3, EXIF.
- `src/presets/`: formato de preset e herança (`extends`).
- `src/app/`: estado do editor e carregamento de fotos/presets.
- `src/ui/`: interface Svelte 5.
- `public/presets`, `public/luts`: presets oficiais; `presets/manifest.json` é gerado no build.

Os presets do cssco são MIT, © 2016 Lauren Waller (ver `public/luts/LICENSE-cssco.txt`).
