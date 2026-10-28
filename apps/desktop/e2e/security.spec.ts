import { expect, test } from './fixtures'

test.describe('window isolation', () => {
  test('the page has no Node access, only the typed API', async ({ app }) => {
    const result = await app.main.evaluate(() => ({
      require: typeof (window as unknown as Record<string, unknown>)['require'],
      process: typeof (window as unknown as Record<string, unknown>)['process'],
      ipc: typeof (window as unknown as Record<string, unknown>)['ipcRenderer'],
      api: Object.keys((window as unknown as { api: object }).api).sort()
    }))
    expect(result.require).toBe('undefined')
    expect(result.process).toBe('undefined')
    expect(result.ipc).toBe('undefined')
    expect(result.api).toEqual(
      [
        'addStarterPrompts',
        'chooseLibraryFolder',
        'copyPrompt',
        'createDefaultLibrary',
        'getAppInfo',
        'getLibraryState',
        'getPrompt',
        'onLibraryChanged',
        'openFill',
        'readClipboard',
        'searchPrompts'
      ].sort()
    )
  })

  test('both windows have a strict content security policy', async ({ app }) => {
    for (const page of [app.main, app.launcher]) {
      const csp = await page
        .locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content')
      expect(csp).toContain("default-src 'self'")
      expect(csp).not.toContain('unsafe-eval')
    }
  })

  test('cannot navigate away or open new windows', async ({ app }) => {
    const { main } = app
    const before = main.url()
    const opened = await main.evaluate(() => window.open('https://example.com') === null)
    expect(opened).toBe(true)
    await main.evaluate(() => {
      window.location.href = 'https://example.com/'
    })
    await main.waitForTimeout(500)
    expect(main.url()).toBe(before)
    expect(app.app.windows()).toHaveLength(2)
  })

  test('makes no network requests', async ({ app }) => {
    const failed = await app.main.evaluate(() =>
      fetch('https://example.com/').then(
        () => false,
        () => true
      )
    )
    expect(failed).toBe(true)
  })

  test('the launcher window exists but stays hidden', async ({ app }) => {
    const visible = await app.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => w.isVisible())
    )
    expect(visible.filter(Boolean)).toHaveLength(1)
    expect(visible).toHaveLength(2)
  })
})

test.describe('IPC validation', () => {
  test('rejects malformed requests instead of acting on them', async ({ app }) => {
    const api = (page: typeof app.main, call: string) =>
      page.evaluate(
        (source) =>
          (
            new Function('api', `return ${source}`)(
              (window as unknown as { api: unknown }).api
            ) as Promise<unknown>
          ).then(
            () => 'resolved',
            (e: Error) => `rejected: ${e.message}`
          ),
        call
      )
    expect(await api(app.main, "api.openFill('')")).toContain('rejected')
    expect(await api(app.main, 'api.openFill(42)')).toContain('rejected')
    expect(
      await api(app.main, "api.copyPrompt('code-review', { a: { nested: 1 } }, '')")
    ).toContain('rejected')
    expect(await api(app.main, "api.copyPrompt('code-review', {}, 5)")).toContain('rejected')
    expect(await api(app.main, "api.searchPrompts('x'.repeat(600))")).toContain('rejected')
  })

  test('says a prompt is missing rather than failing, for an id that does not exist', async ({
    app
  }) => {
    const result = await app.main.evaluate(() =>
      (
        window as unknown as { api: { copyPrompt(...a: unknown[]): Promise<unknown> } }
      ).api.copyPrompt('no-such-prompt', {}, '')
    )
    expect(result).toEqual({ status: 'missing' })
  })

  test('refuses a prompt id that tries to leave the library', async ({ app }) => {
    const detail = await app.main.evaluate(() =>
      (window as unknown as { api: { getPrompt(id: string): Promise<unknown> } }).api.getPrompt(
        '../../etc/passwd'
      )
    )
    expect(detail).toBeNull()
  })
})
