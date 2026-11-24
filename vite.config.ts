import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { playwright } from '@vitest/browser-playwright';
import { presetsManifest } from './build/presets-manifest.ts';

export default defineConfig({
  // Caminhos relativos: funciona tanto na raiz (Cloudflare Pages) quanto num
  // subcaminho (GitHub Pages).
  base: './',
  plugins: [
    svelte(),
    presetsManifest(),
    VitePWA({
      // Sem skipWaiting/clientsClaim: a versão nova fica em espera e só vale
      // numa abertura a frio, nunca no meio de uma edição.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'nathcam',
        short_name: 'nathcam',
        description: 'Editor de fotos centrado em presets',
        lang: 'pt-BR',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111111',
        theme_color: '#111111',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,cube,wasm,png,svg,webmanifest}'],
        // libheif (~2 MB) só é baixado quando chega um HEIC que o navegador não
        // abre sozinho (o Safari abre); depois fica em cache para uso offline.
        globIgnores: ['**/libheif-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/libheif-[^/]*\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'libheif', expiration: { maxEntries: 2 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        skipWaiting: false,
        clientsClaim: false,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@jsquash/jpeg'],
  },
  worker: { format: 'es' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'build/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        extends: true,
        define: { __UPDATE_REFS__: JSON.stringify(!!process.env.UPDATE_REFS) },
        test: {
          name: 'engine',
          include: ['src/**/*.browser.test.ts'],
          testTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
              launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
