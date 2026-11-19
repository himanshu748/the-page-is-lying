import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// Forge serves the bundle from a sub-path, so assets must be relative.
export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  resolve: { alias: { '@core': fileURLToPath(new URL('../../src/core', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
