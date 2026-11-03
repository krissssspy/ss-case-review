import { expect, test } from 'vitest';
import configuration from '../vitest.config.ts';

test('bounds fast-test worker concurrency without relaxing quality gates', () => {
  expect(configuration).toMatchObject({
    test: {
      maxWorkers: 4,
      pool: 'forks',
      fileParallelism: false,
      allowOnly: false,
      passWithNoTests: false,
      coverage: {
        thresholds: { lines: 93, statements: 93, functions: 93, branches: 93, perFile: true },
      },
    },
  });
});
