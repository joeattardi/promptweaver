import { expect, test as base } from '@playwright/test'
import { launch, makeSandbox, type Launched, type Sandbox } from './app'

interface Fixtures {
  /** Set `test.use({ withLibrary: false })` for a first run with no library chosen. */
  withLibrary: boolean
  sandbox: Sandbox
  app: Launched
}

export const test = base.extend<Fixtures>({
  withLibrary: [true, { option: true }],
  sandbox: async ({ withLibrary }, use) => {
    const sandbox = await makeSandbox({ withLibrary })
    await use(sandbox)
    await sandbox.cleanup()
  },
  app: async ({ sandbox, withLibrary }, use) => {
    const app = await launch(sandbox)
    // Start every test from a settled window: the library loaded and the first form open.
    if (withLibrary) {
      await expect(app.main.getByRole('form', { name: 'Fill in the prompt' })).toBeVisible()
    }
    await use(app)
    await app.close()
  }
})

export { expect }
