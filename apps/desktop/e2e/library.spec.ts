import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'

test.describe('browsing the library', () => {
  test('lists the prompts, with folders as headings', async ({ app }) => {
    const { main } = app
    await expect(main.getByText('3 prompts')).toBeVisible()
    const options = main.getByRole('option')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toContainText('Code Review')
    await expect(options.nth(1)).toContainText('Plain Note')
    await expect(options.nth(2)).toContainText('Standup Summary')
    await expect(main.getByText('work', { exact: true })).toBeVisible()
    // The first prompt is selected and its form is showing.
    await expect(main.getByRole('heading', { level: 2, name: 'Code Review' })).toBeVisible()
    await expect(main.getByRole('form', { name: 'Fill in the prompt' })).toBeVisible()
  })

  test('searches by title, and puts an exact alias first', async ({ app }) => {
    const { main } = app
    const search = main.getByRole('combobox', { name: 'Search prompts' })
    await expect(search).toBeFocused()
    await search.fill('standup')
    await expect(main.getByRole('option')).toHaveCount(1)
    await expect(main.getByRole('heading', { level: 2, name: 'Standup Summary' })).toBeVisible()
    await search.fill('pn')
    await expect(main.getByRole('option').first()).toContainText('Plain Note')
    await search.fill('nothing like this')
    await expect(main.getByText(/No prompts match/)).toBeVisible()
    await search.press('Escape')
    await expect(main.getByRole('option')).toHaveCount(3)
  })

  test('moves between prompts with the arrow keys while typing in the search box', async ({
    app
  }) => {
    const { main } = app
    await main.getByRole('combobox', { name: 'Search prompts' }).press('ArrowDown')
    await expect(main.getByRole('heading', { level: 2, name: 'Plain Note' })).toBeVisible()
    await main.getByRole('combobox', { name: 'Search prompts' }).press('ArrowDown')
    await expect(main.getByRole('heading', { level: 2, name: 'Standup Summary' })).toBeVisible()
  })

  test('shows the details of a prompt', async ({ app }) => {
    const { main } = app
    await main.getByRole('tab', { name: 'Details' }).click()
    const panel = main.getByRole('tabpanel')
    await expect(panel.getByText('cr', { exact: true })).toBeVisible()
    await expect(panel.getByText('code', { exact: true })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Questions' })).toBeVisible()
    await expect(
      panel.getByText('You are a {{language}} reviewer.', { exact: false })
    ).toBeVisible()
  })

  test('notices prompts added and removed on disk', async ({ app, sandbox }) => {
    const { main } = app
    await writeFile(
      join(sandbox.libraryDir, 'fresh.md'),
      '---\ntitle: Fresh Idea\naliases: [fi]\n---\nBrand new.\n'
    )
    await expect(main.getByRole('option', { name: /Fresh Idea/ })).toBeVisible()
    await expect(main.getByText('4 prompts')).toBeVisible()
    await rm(join(sandbox.libraryDir, 'fresh.md'))
    await expect(main.getByRole('option', { name: /Fresh Idea/ })).toHaveCount(0)
    await expect(main.getByText('3 prompts')).toBeVisible()
  })

  test('lists a file it cannot read instead of skipping it', async ({ app, sandbox }) => {
    await mkdir(join(sandbox.libraryDir, 'sub'), { recursive: true })
    await writeFile(
      join(sandbox.libraryDir, 'sub', 'broken.md'),
      Buffer.from([0xff, 0xfe, 0x00, 0x81])
    )
    await expect(app.main.getByText(/couldn’t be loaded/)).toBeVisible()
    await expect(app.main.getByText('sub/broken.md')).toBeVisible()
  })
})

test.describe('first run', () => {
  test.use({ withLibrary: false })

  test('shows the welcome screen and uses a folder the user picks', async ({ app, sandbox }) => {
    const { main } = app
    await expect(main.getByRole('heading', { name: /Welcome/ })).toBeVisible()
    await expect(main.getByRole('combobox')).toHaveCount(0)

    // Stand in for the native folder picker.
    await app.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, sandbox.libraryDir)
    await main.getByRole('button', { name: 'Choose an existing folder…' }).click()

    await expect(main.getByRole('option')).toHaveCount(3)
    const settings = JSON.parse(await readFile(join(sandbox.dataDir, 'settings.json'), 'utf8'))
    expect(settings.libraryPath).toBe(sandbox.libraryDir)
  })

  test('changes nothing when the picker is cancelled', async ({ app, sandbox }) => {
    await app.app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    })
    await app.main.getByRole('button', { name: 'Choose an existing folder…' }).click()
    await expect(app.main.getByRole('heading', { name: /Welcome/ })).toBeVisible()
    await expect(readFile(join(sandbox.dataDir, 'settings.json'))).rejects.toThrow()
  })
})
