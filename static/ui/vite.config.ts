import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// Forge serves the bundle from a sub-path, so assets must be relative.
export default defineConfig(({ mode }) => ({
  root,
  base: './',
  plugins: [react()],
  resolve: { alias: { '@core': fileURLToPath(new URL('../../src/core', import.meta.url)) } },
  build: {
    outDir: mode === 'judge-demo' ? '../../dist/judge-demo' : 'dist',
    emptyOutDir: true,
    sourcemap: false,
    ...(mode === 'judge-demo' && { rolldownOptions: { input: fileURLToPath(new URL('local-demo.html', import.meta.url)) } }),
  },
}));
