import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Each test starts a database in memory: on a busy machine or in CI that alone can pass the default 5 s.
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
