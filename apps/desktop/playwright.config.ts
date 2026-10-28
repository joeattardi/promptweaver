import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built app (`npm run build` first; `npm run test:e2e` does both).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  // Each test launches its own Electron with its own data folder, but the app is heavy: keep it modest.
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  outputDir: 'test-results'
})
