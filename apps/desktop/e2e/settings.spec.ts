import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { join } from 'node:path'
import { DEFAULT_HOTKEY, launch, readJson } from './app'
import { expect, test } from './fixtures'

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings…' }).click()
  return page.getByRole('dialog', { name: 'Settings' })
}

test.describe('the launcher shortcut', () => {
  test('works out of the box', async ({ app }) => {
    expect(await app.press(DEFAULT_HOTKEY)).toBe(true)
    await expect.poll(() => app.launcherVisible()).toBe(true)
    await expect(app.main.getByText(/shortcut isn’t working/)).toBeHidden()
  })

  test('can be changed by pressing the new keys, and the old one stops working', async ({
    app,
    sandbox
  }) => {
    const dialog = await openSettings(app.main)
    await dialog.getByRole('button', { name: /⌃⌥Space|Ctrl\+Alt\+Space/ }).click()
    await app.main.keyboard.press('Control+Alt+KeyK')
    await expect(dialog.getByRole('status')).toHaveText('Shortcut changed.')

    expect(await app.press(DEFAULT_HOTKEY)).toBe(false)
    expect(await app.press('Control+Alt+K')).toBe(true)
    await expect.poll(() => app.launcherVisible()).toBe(true)

    const settings = (await readJson(join(sandbox.dataDir, 'settings.json'))) as {
      launcherHotkey: string
    }
    expect(settings.launcherHotkey).toBe('Control+Alt+K')
  })

  test('is remembered across a restart', async ({ app, sandbox }) => {
    const dialog = await openSettings(app.main)
    await dialog.getByRole('button', { name: /⌃⌥Space|Ctrl\+Alt\+Space/ }).click()
    await app.main.keyboard.press('Control+Alt+KeyJ')
    await expect(dialog.getByRole('status')).toHaveText('Shortcut changed.')
    await app.close()

    const again = await launch(sandbox)
    try {
      expect(await again.press(DEFAULT_HOTKEY)).toBe(false)
      expect(await again.press('Control+Alt+J')).toBe(true)
    } finally {
      await again.close()
    }
  })

  test('refuses a key pressed with no modifier', async ({ app }) => {
    const dialog = await openSettings(app.main)
    await dialog.getByRole('button', { name: /⌃⌥Space|Ctrl\+Alt\+Space/ }).click()
    await app.main.keyboard.press('KeyK')
    await expect(dialog.getByRole('alert')).toContainText('Include Ctrl, Alt, Option or Command')
    expect(await app.press('Control+Alt+K')).toBe(false)
  })

  test.describe('when another app already has it', () => {
    test.use({ takenShortcuts: [DEFAULT_HOTKEY] })

    test('says so in the main window, and recovers once another shortcut is chosen', async ({
      app
    }) => {
      const warning = app.main.getByRole('alert').filter({ hasText: 'shortcut isn’t working' })
      await expect(warning).toContainText('already used by another app')
      expect(await app.press(DEFAULT_HOTKEY)).toBe(false)

      await warning.getByRole('button', { name: 'Choose a shortcut' }).click()
      const dialog = app.main.getByRole('dialog', { name: 'Settings' })
      await dialog.getByRole('button', { name: /not active/ }).click()
      await app.main.keyboard.press('Control+Alt+KeyK')
      await expect(dialog.getByRole('status')).toHaveText('Shortcut changed.')
      await dialog.getByRole('button', { name: 'Done' }).click()

      await expect(warning).toBeHidden()
      expect(await app.press('Control+Alt+K')).toBe(true)
      await expect.poll(() => app.launcherVisible()).toBe(true)
    })

    test('refuses to choose a shortcut that another app holds', async ({ app }) => {
      const dialog = await openSettings(app.main)
      await dialog.getByRole('button', { name: /not active/ }).click()
      await app.main.keyboard.press('Control+Alt+Space')
      await expect(dialog.getByRole('alert')).toContainText('already used by another app')
    })
  })
})

test.describe('settings dialog', () => {
  test('opens from the header and closes with Escape', async ({ app }) => {
    const dialog = await openSettings(app.main)
    await expect(dialog.getByRole('checkbox', { name: /when you log in/ })).toBeDisabled()
    await app.main.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('shows the library folder and nothing is written until something changes', async ({
    app,
    sandbox
  }) => {
    const dialog = await openSettings(app.main)
    await expect(dialog).toContainText(sandbox.libraryDir)
    const saved = await readFile(join(sandbox.dataDir, 'settings.json'), 'utf8')
    expect(JSON.parse(saved)).toEqual({ libraryPath: sandbox.libraryDir })
  })
})
