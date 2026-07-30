import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Integration tests share one TEST_DATABASE_URL, and migrate.test.ts drops the
  // public schema, so test files must not run against it concurrently.
  test: { fileParallelism: false },
});
