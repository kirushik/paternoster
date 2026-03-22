import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.vitest-cache',
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
});
