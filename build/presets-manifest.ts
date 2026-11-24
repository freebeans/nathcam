import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { resolvePresets, type PresetFile } from '../src/presets/inheritance.ts';

export const MANIFEST_PATH = 'presets/manifest.json';

/** Lê `public/presets/*.json`, resolve `extends` e monta o manifest. */
export function buildManifest(publicDir: string): string {
  const dir = join(publicDir, 'presets');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as PresetFile);
  const presets = resolvePresets(files);
  const packs = [...new Set(presets.map((p) => p.pack))];
  return JSON.stringify({ packs, presets }, null, 2);
}

/** Gera `presets/manifest.json` no build e o serve no modo dev. */
export function presetsManifest(): Plugin {
  let publicDir = resolve('public');
  return {
    name: 'presets-manifest',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.split('?')[0].endsWith('/' + MANIFEST_PATH)) return next();
        try {
          res.setHeader('Content-Type', 'application/json');
          res.end(buildManifest(publicDir));
        } catch (e) {
          next(e);
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: MANIFEST_PATH, source: buildManifest(publicDir) });
    },
  };
}
