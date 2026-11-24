# CLAUDE.md

Editor de fotos PWA, estilo VSCO, centrado em presets, 100% front-end (hospedagem estática). Uso pessoal da autora; roda em iPhone (Safari) e Android (Chrome).

O PRD completo está em `docs/PRD.md`. Leia a seção correspondente antes de mexer em: pipeline do motor, gestão de cor, formato de preset, armazenamento ou importação de XMP.

## Vocabulário

- **Motor**: o renderer WebGL2 em `src/engine/`. TypeScript + GLSL puros, sem importar nada da interface.
- **Receita**: o estado completo de edição de uma foto (JSON): cópia do preset aplicado, intensidade, camada do usuário, recorte, `engineVersion`.
- **Camadas**: preset (embaixo, escalado pela intensidade) + ajustes do usuário (por cima, somados). A CPU resolve as duas num único conjunto de parâmetros efetivos antes de chegar ao shader.
- **Pack**: grupo de presets exibido como aba.

## Invariantes do motor

- Um único motor serve a pré-visualização e a exportação. A exportação roda o mesmo shader em tiles com sobreposição. O que se vê é o que se exporta.
- A ordem do pipeline mora num único arquivo (`src/engine/pipeline.ts`) e segue o PRD. Para adicionar uma etapa, insira-a lá e documente a posição no PRD.
- Espaço de trabalho: Display P3 linear. LUTs sRGB recebem compressão suave de gama antes de serem aplicadas; LUTs com `colorSpace: "display-p3"` passam direto.
- Grão, textura, clareza e nitidez são parametrizados em proporção ao tamanho da imagem, nunca em pixels.
- Qualquer mudança que altere o resultado de receitas existentes incrementa `ENGINE_VERSION` e mantém o caminho antigo acessível pela `engineVersion` da receita.
- O motor detecta recursos (P3, texturas float16) e degrada para sRGB e 8 bits com dithering.

## Presets

- Presets oficiais são arquivos estáticos em `public/presets/` e `public/luts/`; o `manifest.json` é gerado no build. `extends` é permitido só nesses arquivos.
- Presets salvos pelo app gravam a receita achatada. Presets do servidor são somente leitura: editar cria uma cópia local.
- O repositório contém apenas os presets convertidos do cssco (MIT, manter o aviso de copyright) e presets autorais. Presets da comunidade entram só por importação local no aparelho.
- Importação de XMP mapeia sliders e calibração para os controles equivalentes; perfis de câmera, lentes, máscaras e recorte são ignorados.

## Dados

- Todo dado persistente vai para o IndexedDB (fotos, receitas, histórico, presets, LUTs em binário). O localStorage guarda só preferências pequenas de interface.
- Trate o IndexedDB como descartável: o iOS pode apagá-lo. Presets locais são protegidos pelo backup `.zip`.

## Plataforma

- Teste mudanças de render e memória pensando no Safari iOS primeiro: limite de área de canvas, memória de textura e armazenamento separado da PWA instalada.
- A exportação codifica JPEG em WASM a partir dos pixels lidos da GPU, com perfil ICC Display P3 e EXIF do original embutidos.
- O service worker atualiza em segundo plano e ativa a versão nova só numa abertura a frio, para nunca trocar o motor no meio de uma edição.

## Testes

- Lógica pura (parsers `.cube`/`.xmp`, resolução de camadas e herança, histórico): testes unitários.
- Motor: testes de imagem de referência num navegador headless, comparando com tolerância. Toda mudança no shader termina com esses testes verdes; quando a mudança é intencional, regenere as referências e explique o motivo no commit.
