import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The UI renderer imports the shared core through this alias (static/ui/vite.config.ts has the same one).
  resolve: { alias: { '@core': fileURLToPath(new URL('./src/core', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    // Default is 5 s. Property and 5,000-file tests exceed it when the machine is loaded; real slowness is still
    // caught by the per-input bounds in test/core/index/robustness.test.ts.
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/model.ts'],
      reporter: ['text', 'lcov'],
      // Thresholds apply once the core has real code (Tasks A to C); enable with COVERAGE_GATE=1.
      thresholds: process.env['COVERAGE_GATE'] ? { lines: 90 } : {},
    },
  },
});
