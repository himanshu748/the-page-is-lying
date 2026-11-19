import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// Same app, but @forge/bridge is replaced by a mock so Playwright runs outside Confluence.
export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@forge/bridge': fileURLToPath(new URL('./e2e/bridge-mock.ts', import.meta.url)),
      '@core': fileURLToPath(new URL('../../src/core', import.meta.url)),
    },
  },
  server: { port: 4173, strictPort: true },
});
