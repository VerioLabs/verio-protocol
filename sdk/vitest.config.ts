import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Test files deploy with `forge script` to anvils that all have chain id 31337; run in
    // parallel they contend for the same broadcast files and deployments/31337.json.
    fileParallelism: false,
  },
})
