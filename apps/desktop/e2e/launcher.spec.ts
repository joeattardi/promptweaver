import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { Launched } from './app'
import { expect, test } from './fixtures'

const search = (page: Page) => page.getByRole('combobox', { name: 'Search prompts' })
const option = (page: Page, name: string | RegExp) => page.getByRole('option', { name })
const form = (page: Page) => page.getByRole('form', { name: 'Fill in the prompt' })
const code = (page: Page) => page.getByRole('textbox', { name: /^Code/ })

/** Presses the hotkey and waits until the launcher is up with its search box ready. */
async function summon(app: Launched): Promise<void> {
  expect(await app.press()).toBe(true)
  await expect.poll(() => app.launcherVisible()).toBe(true)
  await expect(search(app.launcher)).toBeFocused()
}

test.describe('summoning', () => {
  test('the hotkey shows the launcher with the library listed and the search box focused', async ({
    app
  }) => {
    expect(await app.launcherVisible()).toBe(false)
    await summon(app)
    await expect(option(app.launcher, /Code Review/)).toBeVisible()
    await expect(option(app.launcher, /Plain Note/)).toBeVisible()
    await expect(option(app.launcher, /Standup Summary/)).toBeVisible()
    await expect(option(app.launcher, 'New prompt from clipboard')).toBeVisible()
  })

  test('is horizontally centered and in the upper part of the screen', async ({ app }) => {
    await summon(app)
    const bounds = await app.launcherBounds()
    const area = await app.app.evaluate(({ screen }) => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      return display.workArea
    })
    expect(bounds.width).toBe(640)
    expect(bounds.x + bounds.width / 2).toBeCloseTo(area.x + area.width / 2, -1)
    expect(bounds.y).toBeLessThan(area.y + area.height / 2)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height)
  })

  test('is the same window every time, not a new one', async ({ app }) => {
    const count = () =>
      app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    const before = await count()
    await summon(app)
    await app.launcher.keyboard.press('Escape')
    await expect.poll(() => app.launcherVisible()).toBe(false)
    await summon(app)
    expect(await count()).toBe(before)
  })

  test('pressing the hotkey again hides it', async ({ app }) => {
    await summon(app)
    await app.press()
    await expect.poll(() => app.launcherVisible()).toBe(false)
  })

  test('starts over each time: back at the search step with an empty box', async ({ app }) => {
    await summon(app)
    await search(app.launcher).fill('cr')
    await app.launcher.keyboard.press('Enter')
    await expect(form(app.launcher)).toBeVisible()
    await app.press()
    await expect.poll(() => app.launcherVisible()).toBe(false)
    await summon(app)
    await expect(form(app.launcher)).toBeHidden()
    await expect(search(app.launcher)).toHaveValue('')
  })

  test('hides when it loses focus', async ({ app }) => {
    await summon(app)
    // Past the moment right after showing, when a focus change is just the window settling.
    await app.launcher.waitForTimeout(400)
    await app.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.getBounds().width === 640)
        ?.emit('blur')
    })
    await expect.poll(() => app.launcherVisible()).toBe(false)
  })

  test('does not hide itself the instant it appears', async ({ app }) => {
    await summon(app)
    await app.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.getBounds().width === 640)
        ?.emit('blur')
    })
    await app.launcher.waitForTimeout(150)
    expect(await app.launcherVisible()).toBe(true)
  })
})

test.describe('finding and filling a prompt without the mouse', () => {
  test('cr, Enter, answer, Ctrl/Cmd+Enter copies the finished prompt and gets out of the way', async ({
    app
  }) => {
    await app.clipboard.write('func main() {}')
    await summon(app)
    await app.launcher.keyboard.type('cr')
    await expect(option(app.launcher, /Code Review/)).toHaveAttribute('aria-selected', 'true')
    await app.launcher.keyboard.press('Enter')

    await expect(form(app.launcher)).toBeVisible()
    // The first question has the keyboard, and the clipboard filled the code.
    await expect(app.launcher.getByRole('radio', { name: /TypeScript/ })).toBeFocused()
    await expect(code(app.launcher)).toHaveValue('func main() {}')

    await app.launcher.keyboard.press('3') // Go
    await expect(app.launcher.getByRole('radio', { name: /Go/ })).toBeChecked()
    await app.launcher.keyboard.press('ControlOrMeta+Enter')

    await expect(app.launcher.getByText('Copied to clipboard')).toBeVisible()
    expect(await app.clipboard.read()).toBe(
      'You are a Go reviewer. Be encouraging.\nFocus on: Bugs.\nCount: \nfunc main() {}\n'
    )
    await expect.poll(() => app.launcherVisible()).toBe(false)
  })

  test('uses the clipboard from the moment of the hotkey, not whatever is there later', async ({
    app
  }) => {
    await app.clipboard.write('AAA copied before the hotkey')
    await summon(app)
    await app.clipboard.write('BBB copied afterwards')
    await app.launcher.keyboard.type('cr')
    await app.launcher.keyboard.press('Enter')
    await expect(code(app.launcher)).toHaveValue('AAA copied before the hotkey')
    await app.launcher.keyboard.press('ControlOrMeta+Enter')
    await expect.poll(() => app.clipboard.read()).toContain('AAA copied before the hotkey')
  })

  test('Enter on a prompt with no questions copies it straight away', async ({ app }) => {
    await summon(app)
    await app.launcher.keyboard.type('pn')
    await expect(option(app.launcher, /Plain Note/)).toHaveAttribute('aria-selected', 'true')
    await app.launcher.keyboard.press('Enter')
    await expect(form(app.launcher)).toBeHidden()
    await expect.poll(() => app.clipboard.read()).toBe('Just a fixed prompt with no questions.\n')
    await expect.poll(() => app.launcherVisible()).toBe(false)
  })

  test('typing before the first search has answered still opens the right prompt', async ({
    app
  }) => {
    await summon(app)
    await app.launcher.keyboard.type('pn')
    // No waiting between the last key and Enter.
    await app.launcher.keyboard.press('Enter')
    await expect.poll(() => app.clipboard.read()).toBe('Just a fixed prompt with no questions.\n')
  })

  test('a required answer that is missing is focused instead of copying', async ({ app }) => {
    await app.clipboard.write('')
    await summon(app)
    await app.launcher.keyboard.type('cr')
    await app.launcher.keyboard.press('Enter')
    await expect(form(app.launcher)).toBeVisible()
    await app.launcher.keyboard.press('ControlOrMeta+Enter')
    await expect(code(app.launcher)).toBeFocused()
    await expect(code(app.launcher)).toHaveAttribute('aria-invalid', 'true')
    expect(await app.clipboard.read()).toBe('')
    expect(await app.launcherVisible()).toBe(true)
  })

  test('Escape steps back one level: form to search, then closes', async ({ app }) => {
    await summon(app)
    await app.launcher.keyboard.type('cr')
    await app.launcher.keyboard.press('Enter')
    await expect(form(app.launcher)).toBeVisible()
    await app.launcher.keyboard.press('Escape')
    await expect(form(app.launcher)).toBeHidden()
    await expect(search(app.launcher)).toHaveValue('cr')
    await expect(search(app.launcher)).toBeFocused()
    expect(await app.launcherVisible()).toBe(true)
    await app.launcher.keyboard.press('Escape')
    await expect.poll(() => app.launcherVisible()).toBe(false)
  })

  test('arrow keys move through the list and Enter picks', async ({ app }) => {
    await summon(app)
    await app.launcher.keyboard.press('ArrowDown')
    await app.launcher.keyboard.press('ArrowDown')
    const selected = app.launcher.getByRole('option', { selected: true })
    await expect(selected).toHaveCount(1)
    const name = await selected.getAttribute('aria-label')
    await app.launcher.keyboard.press('Enter')
    await expect(app.launcher.getByRole('heading', { level: 1 })).toHaveText(name ?? '')
  })

  test('fills a prompt with an implicit field and the built-in date', async ({ app }) => {
    await summon(app)
    await app.launcher.keyboard.type('standup')
    await app.launcher.keyboard.press('Enter')
    await app.launcher.getByRole('textbox', { name: 'Notes' }).fill('shipped the launcher')
    await app.launcher.keyboard.press('Enter') // Enter submits from a single-line field
    await expect
      .poll(() => app.clipboard.read())
      .toMatch(/^Summarize shipped the launcher as a standup update for \d{4}-\d{2}-\d{2}\.\n$/)
  })

  test('shows a live preview with Ctrl/Cmd+P', async ({ app }) => {
    await summon(app)
    await app.launcher.keyboard.type('cr')
    await app.launcher.keyboard.press('Enter')
    await expect(form(app.launcher)).toBeVisible()
    await app.launcher.keyboard.press('ControlOrMeta+p')
    await expect(app.launcher.getByRole('region', { name: 'Preview' })).toContainText(
      'You are a TypeScript reviewer'
    )
  })
})

test.describe('recents and favorites', () => {
  test('a prompt that was used is listed first next time', async ({ app }) => {
    await summon(app)
    await app.launcher.keyboard.type('pn')
    await app.launcher.keyboard.press('Enter')
    await expect.poll(() => app.launcherVisible()).toBe(false)
    await summon(app)
    await expect(app.launcher.getByText('Recent', { exact: true })).toBeVisible()
    await expect(app.launcher.getByRole('option').first()).toHaveAccessibleName(/Plain Note/)
  })

  test('a favorite is listed first, and survives a restart', async ({ app, sandbox }) => {
    await summon(app)
    await app.launcher.keyboard.press('ArrowDown') // Plain Note
    await app.launcher.keyboard.press('ControlOrMeta+d')
    await expect(app.launcher.getByRole('option', { name: /favorite/ })).toBeVisible()
    await app.press() // hide
    await expect.poll(() => app.launcherVisible()).toBe(false)

    await summon(app)
    await expect(app.launcher.getByText('Favorites', { exact: true })).toBeVisible()
    await expect(app.launcher.getByRole('option').first()).toHaveAccessibleName(/favorite/)

    // The main window shows the same star.
    await expect(app.main.getByRole('option', { name: /favorite/ })).toBeVisible()

    const state = JSON.parse(await readFile(join(sandbox.dataDir, 'state.json'), 'utf8')) as {
      favorites: string[]
    }
    expect(state.favorites).toHaveLength(1)
  })
})

test.describe('new prompt from clipboard', () => {
  test('Ctrl/Cmd+N saves the clipboard as a prompt and shows it in the main window', async ({
    app,
    sandbox
  }) => {
    await app.clipboard.write('Explain this error\nin plain words, {{like}} I am new')
    await summon(app)
    await app.launcher.keyboard.press('ControlOrMeta+n')

    await expect.poll(() => app.launcherVisible()).toBe(false)
    const text = await readFile(join(sandbox.libraryDir, 'explain-this-error.md'), 'utf8')
    expect(text).toBe(
      '---\ntitle: Explain this error\nformat: 1\n---\nExplain this error\nin plain words, \\{{like}} I am new\n'
    )
    // The main window comes forward with the new prompt selected.
    await expect(
      app.main.getByRole('heading', { level: 2, name: 'Explain this error' })
    ).toBeVisible()
    expect(
      await app.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getBounds().width === 1000)
          ?.isVisible()
      )
    ).toBe(true)
  })

  test('typing "new" and Enter does the same', async ({ app, sandbox }) => {
    await app.clipboard.write('Summarize the meeting')
    await summon(app)
    await app.launcher.keyboard.type('new')
    await expect(option(app.launcher, 'New prompt from clipboard')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await app.launcher.keyboard.press('Enter')
    await expect
      .poll(async () => (await readdir(sandbox.libraryDir)).includes('summarize-the-meeting.md'))
      .toBe(true)
  })

  test('says so, and creates nothing, when the clipboard has no text', async ({ app, sandbox }) => {
    const before = (await readdir(sandbox.libraryDir)).sort()
    await app.clipboard.write('')
    await summon(app)
    await app.launcher.keyboard.press('ControlOrMeta+n')
    await expect(app.launcher.getByRole('alert')).toContainText('The clipboard has no text')
    expect(await app.launcherVisible()).toBe(true)
    expect((await readdir(sandbox.libraryDir)).sort()).toEqual(before)
  })
})

test.describe('the window fits its content', () => {
  test('is shorter for fewer matches', async ({ app }) => {
    await summon(app)
    await expect.poll(async () => (await app.launcherBounds()).height).toBeGreaterThan(250)
    const tall = (await app.launcherBounds()).height
    await app.launcher.keyboard.type('cr')
    await expect(app.launcher.getByRole('option')).toHaveCount(1)
    await expect.poll(async () => (await app.launcherBounds()).height).toBeLessThan(tall - 100)
  })

  test('never grows past the maximum, however long the form', async ({ app }) => {
    await summon(app)
    await app.launcher.keyboard.type('cr')
    await app.launcher.keyboard.press('Enter')
    await expect(form(app.launcher)).toBeVisible()
    await app.launcher.keyboard.press('ControlOrMeta+p')
    await app.launcher.waitForTimeout(200)
    expect((await app.launcherBounds()).height).toBeLessThanOrEqual(640)
  })
})

test.describe('before there is a library', () => {
  test.use({ withLibrary: false })

  test('offers to open the app instead of an empty list', async ({ app }) => {
    await summon(app)
    await expect(
      app.launcher.getByText('Choose a folder for your prompts to get started.')
    ).toBeVisible()
    await app.launcher.getByRole('button', { name: 'Open Promptweaver' }).click()
    await expect.poll(() => app.launcherVisible()).toBe(false)
  })
})
