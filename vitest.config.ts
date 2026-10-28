import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'prompt-lang', root: 'packages/prompt-lang', include: ['src/**/*.test.ts'] }
      },
      { test: { name: 'desktop', root: 'apps/desktop', include: ['src/**/*.test.ts'] } }
    ]
  }
})
