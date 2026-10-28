import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'prompt-lang', root: 'packages/prompt-lang', include: ['src/**/*.test.ts'] }
      },
      { test: { name: 'desktop', root: 'apps/desktop', include: ['src/**/*.test.ts'] } },
      {
        // React components, run in jsdom. Playwright's end-to-end tests live in apps/desktop/e2e.
        plugins: [react()],
        test: {
          name: 'renderer',
          root: 'apps/desktop',
          include: ['src/renderer/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['src/renderer/src/test/setup.ts']
        }
      }
    ]
  }
})
