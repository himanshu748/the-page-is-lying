import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ui = `${repo}static/ui/`;
const liveFixtures = fileURLToPath(new URL('./fixtures-live.ts', import.meta.url));

// The e2e build of the macro UI (mocked @forge/bridge), with the bridge mock's fixtures swapped
// for fixtures-live.ts. The app source is not modified.
export default defineConfig({
  root: ui,
  cacheDir: process.env['VITE_CACHE_DIR'] ?? `${repo}node_modules/.vite-video`,
  plugins: [
    react(),
    {
      name: 'live-fixtures',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './fixtures' && importer?.endsWith('/e2e/bridge-mock.ts')) return liveFixtures;
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      '@forge/bridge': `${ui}e2e/bridge-mock.ts`,
      '@core': `${repo}src/core`,
    },
  },
  server: { port: 4174, strictPort: true, fs: { allow: [repo] } },
});
