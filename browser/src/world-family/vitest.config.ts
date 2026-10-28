import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/world-family/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
