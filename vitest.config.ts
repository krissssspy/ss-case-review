import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 4,
    pool: 'forks',
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    include: ['packages/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '.stryker-tmp/**', '.tools/**'],
    allowOnly: false,
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      thresholds: {
        lines: 93,
        statements: 93,
        functions: 93,
        branches: 93,
        perFile: true,
      },
    },
  },
});
