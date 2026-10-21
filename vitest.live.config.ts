import { defineConfig } from 'vitest/config';

/** Live checks against official publishers. Never part of the unit suite or its coverage. */
export default defineConfig({
  test: {
    name: 'live',
    environment: 'node',
    include: ['live/**/*.live.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    retry: 1,
    fileParallelism: false,
  },
});
