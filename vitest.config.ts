import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
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
