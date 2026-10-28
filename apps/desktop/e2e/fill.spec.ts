import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { launch } from './app'
import { expect, test } from './fixtures'

const preview = (page: Page) => page.getByRole('region', { name: 'Preview' }).locator('pre')
const copyButton = (page: Page) => page.getByRole('button', { name: /Copy prompt/ })
const form = (page: Page) => page.getByRole('form', { name: 'Fill in the prompt' })
const code = (page: Page) => page.getByRole('textbox', { name: /^Code/ })

test.describe('filling in a prompt', () => {
  test('starts from the clipboard, previews live, and copies the finished prompt', async ({
    app
  }) => {
    const { main, clipboard } = app
    // The form reads the clipboard when it opens, so put the code there and reopen the prompt.
    await clipboard.write('func main() {}')
    await main.getByRole('option', { name: /Plain Note/ }).click()
    await main.getByRole('option', { name: /Code Review/ }).click()
    await expect(code(main)).toHaveValue('func main() {}')
    await expect(preview(main)).toContainText('You are a TypeScript reviewer. Be encouraging.')
    await expect(preview(main)).toContainText('Focus on: Bugs.')

    await main.getByRole('radio', { name: /Blunt/ }).check()
    await main.getByRole('checkbox', { name: 'Security' }).check()
    await main.getByRole('switch', { name: 'Strict' }).check()
    await main.getByRole('spinbutton', { name: 'Count' }).fill('3')
    await expect(preview(main)).toHaveText(
      [
        'You are a TypeScript reviewer. Be direct.',
        'Focus on: Bugs, Security.',
        'Be strict.',
        'Count: 3',
        'func main() {}',
        ''
      ].join('\n')
    )

    await copyButton(main).click()
    await expect(main.getByText('Copied to clipboard')).toBeVisible()
    expect(await clipboard.read()).toBe(await preview(main).evaluate((el) => el.textContent))
    await expect(main.getByText('Copied to clipboard')).toBeHidden({ timeout: 5000 })
  })

  test('is usable from the keyboard alone', async ({ app }) => {
    const { main, clipboard } = app
    await expect(form(main)).toBeVisible()
    await clipboard.write('x')
    await main.getByRole('option', { name: /Plain Note/ }).click()
    await main.getByRole('option', { name: /Code Review/ }).click()
    await expect(code(main)).toHaveValue('x')

    await main.getByRole('radio', { name: /TypeScript/ }).focus()
    await main.keyboard.press('3') // Go
    await expect(main.getByRole('radio', { name: /Go/ })).toBeChecked()
    await main.keyboard.press('p') // type-ahead: Python
    await expect(main.getByRole('radio', { name: /Python/ })).toBeChecked()

    await main.keyboard.press('Tab') // into the multiselect, one tab stop
    await expect(main.getByRole('checkbox', { name: 'Bugs' })).toBeFocused()
    await main.keyboard.press('ArrowDown')
    await main.keyboard.press('Space')
    await expect(main.getByRole('checkbox', { name: 'Performance' })).toBeChecked()

    await main.keyboard.press('Tab') // tone
    await main.keyboard.press('2')
    await expect(main.getByRole('radio', { name: /Blunt/ })).toBeChecked()

    await main.keyboard.press('Tab') // strict switch
    await main.keyboard.press('Space')
    await expect(main.getByRole('switch', { name: 'Strict' })).toBeChecked()

    await main.keyboard.press('Tab') // count
    await main.keyboard.type('2')
    await main.keyboard.press('Control+Enter')
    await expect(main.getByText('Copied to clipboard')).toBeVisible()
    expect(await clipboard.read()).toBe(
      'You are a Python reviewer. Be direct.\nFocus on: Bugs, Performance.\nBe strict.\nCount: 2\nx\n'
    )
  })

  test('Enter in a text field copies, Enter in a textarea does not', async ({ app }) => {
    const { main, clipboard } = app
    await code(main).fill('first line')
    await code(main).press('Enter')
    await expect(code(main)).toHaveValue('first line\n')
    expect(await clipboard.read()).toBe('')
    await main.getByRole('spinbutton', { name: 'Count' }).fill('1')
    await main.getByRole('spinbutton', { name: 'Count' }).press('Enter')
    await expect(main.getByText('Copied to clipboard')).toBeVisible()
    expect(await clipboard.read()).toContain('first line')
  })

  test('refuses to copy a missing answer and takes you to it', async ({ app }) => {
    const { main, clipboard } = app
    // The first form opens as the library loads; let it finish reading the (empty) clipboard.
    await expect(form(main)).toBeVisible()
    await clipboard.write('keep me')
    await copyButton(main).click()
    await expect(code(main)).toBeFocused()
    await expect(code(main)).toHaveAttribute('aria-invalid', 'true')
    await expect(main.getByText('"Code" is required.')).toBeVisible()
    expect(await clipboard.read()).toBe('keep me')

    await code(main).fill('now it is there')
    await expect(main.getByText('"Code" is required.')).toHaveCount(0)
    await copyButton(main).click()
    await expect(main.getByText('Copied to clipboard')).toBeVisible()
  })

  test('rejects a number outside its range', async ({ app }) => {
    const { main, clipboard } = app
    await code(main).fill('x')
    await main.getByRole('spinbutton', { name: 'Count' }).fill('9')
    await copyButton(main).click()
    await expect(main.getByText('"Count" must be between 1 and 5.')).toBeVisible()
    await expect(main.getByRole('spinbutton', { name: 'Count' })).toBeFocused()
    expect(await clipboard.read()).toBe('')
  })

  test('refills a field from the clipboard on request', async ({ app }) => {
    const { main, clipboard } = app
    await clipboard.write('older')
    await main.getByRole('option', { name: /Plain Note/ }).click()
    await main.getByRole('option', { name: /Code Review/ }).click()
    await expect(code(main)).toHaveValue('older')
    await clipboard.write('newer')
    await main.getByRole('button', { name: 'Paste from clipboard' }).click()
    await expect(code(main)).toHaveValue('newer')
    await clipboard.write('')
    await main.getByRole('button', { name: 'Paste from clipboard' }).click()
    await expect(main.getByRole('alert')).toHaveText('The clipboard has no text.')
    await expect(code(main)).toHaveValue('newer')
  })

  test('copies a prompt with no questions as it is', async ({ app }) => {
    const { main, clipboard } = app
    await main.getByRole('option', { name: /Plain Note/ }).click()
    await expect(main.getByText(/No questions\. This prompt/)).toBeVisible()
    await copyButton(main).click()
    await expect(main.getByText('Copied to clipboard')).toBeVisible()
    expect(await clipboard.read()).toBe('Just a fixed prompt with no questions.\n')
  })

  test('asks for a placeholder with no field and fills in the built-in date', async ({ app }) => {
    const { main, clipboard } = app
    await main.getByRole('option', { name: /Standup Summary/ }).click()
    const notes = main.getByRole('textbox', { name: /^Notes/ })
    await expect(main.getByText('not declared in the frontmatter')).toHaveCount(0) // that's the Details tab
    await copyButton(main).click()
    await expect(notes).toBeFocused() // implicit fields are required
    await notes.fill('fixed the bug')
    await copyButton(main).click()
    await expect(main.getByText('Copied to clipboard')).toBeVisible()
    expect(await clipboard.read()).toMatch(
      /^Summarize fixed the bug as a standup update for \d{4}-\d{2}-\d{2}\.\n$/
    )
  })

  test('keeps what you typed when the file changes on disk', async ({ app, sandbox }) => {
    const { main } = app
    const note = main.getByRole('spinbutton', { name: 'Count' })
    await note.fill('4')
    const file = join(sandbox.libraryDir, 'code-review.md')
    const text = await readFile(file, 'utf8')
    await writeFile(file, text.replace('Count: {{count}}', 'Total: {{count}}'))
    await expect(preview(main)).toContainText('Total: 4')
    await expect(note).toHaveValue('4')
  })

  test('does not take focus from the prompt list', async ({ app }) => {
    await expect(app.main.getByRole('combobox', { name: 'Search prompts' })).toBeFocused()
  })
})

test.describe('remembering answers', () => {
  test('restores them next time, even after a restart, but never the clipboard text', async ({
    app,
    sandbox
  }) => {
    const { main, clipboard } = app
    await clipboard.write('secret code from the clipboard')
    await main.getByRole('option', { name: /Plain Note/ }).click()
    await main.getByRole('option', { name: /Code Review/ }).click()
    await main.getByRole('radio', { name: /Go/ }).check()
    await main.getByRole('checkbox', { name: 'Bugs' }).uncheck()
    await main.getByRole('checkbox', { name: 'Security' }).check()
    await main.getByRole('radio', { name: /Blunt/ }).check()
    await copyButton(main).click()
    await expect(main.getByText('Copied to clipboard')).toBeVisible()

    // Back and forth in the same session.
    await main.getByRole('option', { name: /Plain Note/ }).click()
    await main.getByRole('option', { name: /Code Review/ }).click()
    await expect(main.getByRole('radio', { name: /Go/ })).toBeChecked()
    await expect(main.getByRole('checkbox', { name: 'Security' })).toBeChecked()
    await expect(main.getByRole('checkbox', { name: 'Bugs' })).not.toBeChecked()

    const state = JSON.parse(await readFile(join(sandbox.dataDir, 'state.json'), 'utf8'))
    expect(state.lastValues['code-review']).toEqual({
      language: 'Go',
      focus: ['Security'],
      tone: 'Blunt',
      strict: false,
      count: null
    })
    expect(JSON.stringify(state)).not.toContain('secret code')

    // And after quitting and starting again.
    await app.close()
    const again = await launch(sandbox)
    try {
      await expect(again.main.getByRole('radio', { name: /Go/ })).toBeChecked()
      await expect(again.main.getByRole('radio', { name: /Blunt/ })).toBeChecked()
      await expect(again.main.getByRole('checkbox', { name: 'Security' })).toBeChecked()
      await expect(code(again.main)).toHaveValue('')
    } finally {
      await again.close()
    }
  })

  test('does not remember anything when the copy was refused', async ({ app, sandbox }) => {
    const { main } = app
    await main.getByRole('radio', { name: /Python/ }).check()
    await copyButton(main).click() // code is missing
    await expect(code(main)).toBeFocused()
    await expect(readFile(join(sandbox.dataDir, 'state.json'))).rejects.toThrow()
  })
})
