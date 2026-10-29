import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Where the app-side fake clipboard keeps its text. */
interface FakeGlobal {
  __fakeClipboard?: { text: string }
}

const appDir = join(__dirname, '..')
const fixtureLibrary = join(__dirname, 'fixtures', 'library')

/** Where the app keeps its settings and state for one test, plus the library it opens. */
export interface Sandbox {
  dataDir: string
  libraryDir: string
  cleanup(): Promise<void>
}

/** A throwaway data folder and a copy of the fixture library, so a test never touches real data. */
export async function makeSandbox(options: { withLibrary?: boolean } = {}): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), 'pw-e2e-'))
  const dataDir = join(root, 'data')
  const libraryDir = join(root, 'library')
  await cp(fixtureLibrary, libraryDir, { recursive: true })
  await mkdir(dataDir, { recursive: true })
  if (options.withLibrary !== false) {
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ libraryPath: libraryDir }))
  }
  return { dataDir, libraryDir, cleanup: () => rm(root, { recursive: true, force: true }) }
}

export interface LaunchOptions {
  /** Shortcuts the app should find already taken by another app. */
  takenShortcuts?: string[]
}

/** The shortcut that summons the launcher on a fresh install. */
export const DEFAULT_HOTKEY = 'Control+Alt+Space'

export interface Launched {
  app: ElectronApplication
  /** The main window. */
  main: Page
  /** The quick launcher window (hidden until summoned). */
  launcher: Page
  /** Text on the app's fake clipboard. */
  clipboard: { read(): Promise<string>; write(text: string): Promise<void> }
  /** Presses a global shortcut, as the operating system would. False if nothing is registered for it. */
  press(accelerator?: string): Promise<boolean>
  /** Whether the launcher window is on screen right now. */
  launcherVisible(): Promise<boolean>
  launcherBounds(): Promise<{ x: number; y: number; width: number; height: number }>
  /** Lines the app printed with a `[perf]` prefix, oldest first. */
  perfLines(): string[]
  close(): Promise<void>
}

async function windowAt(app: ElectronApplication, file: string): Promise<Page> {
  const find = (): Page | undefined => app.windows().find((w) => w.url().endsWith(file))
  for (let i = 0; i < 100; i++) {
    const page = find()
    if (page) {
      await page.waitForLoadState('domcontentloaded')
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`The ${file} window never opened`)
}

/**
 * Starts the built app against a sandbox. The clipboard is replaced by an in-memory
 * one inside the app, so tests never read or overwrite the real system clipboard.
 */
export async function launch(sandbox: Sandbox, options: LaunchOptions = {}): Promise<Launched> {
  const env = { ...process.env } as Record<string, string>
  // Some editor-integrated shells set this, and Electron then runs as plain Node.
  delete env['ELECTRON_RUN_AS_NODE']
  // In-memory shortcuts that a test can press, and timing lines on stdout.
  env['PROMPTWEAVER_TEST_HOOKS'] = '1'
  env['PROMPTWEAVER_PERF'] = '1'
  env['PROMPTWEAVER_TEST_TAKEN_SHORTCUTS'] = (options.takenShortcuts ?? []).join(',')
  const app = await electron.launch({
    args: [appDir, `--user-data-dir=${sandbox.dataDir}`],
    env
  })
  const perf: string[] = []
  let partial = ''
  app.process().stdout?.on('data', (chunk: Buffer) => {
    const lines = (partial + chunk.toString()).split('\n')
    partial = lines.pop() ?? ''
    perf.push(...lines.filter((line) => line.startsWith('[perf]')))
  })
  await app.evaluate(({ clipboard }) => {
    const fake = { text: '' }
    ;(globalThis as unknown as FakeGlobal).__fakeClipboard = fake
    clipboard.readText = async () => fake.text
    clipboard.writeText = async (text: string) => {
      fake.text = text
    }
  })
  const [main, launcher] = await Promise.all([
    windowAt(app, 'index.html'),
    windowAt(app, 'launcher.html')
  ])
  const clipboard = {
    read: () =>
      app.evaluate(() => (globalThis as unknown as FakeGlobal).__fakeClipboard?.text ?? ''),
    write: (text: string) =>
      app.evaluate((_electron, t) => {
        const fake = (globalThis as unknown as FakeGlobal).__fakeClipboard
        if (fake) fake.text = t
      }, text)
  }
  const launcherWindow = (): Promise<{ visible: boolean; bounds: Electron.Rectangle }> =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getBounds().width === 640)
      if (!win) throw new Error('No launcher window')
      return { visible: win.isVisible(), bounds: win.getBounds() }
    })
  return {
    app,
    main,
    launcher,
    clipboard,
    press: (accelerator = DEFAULT_HOTKEY) =>
      app.evaluate(({ app: electronApp }, key) => {
        const reply = { pressed: false }
        electronApp.emit('promptweaver:press', key, reply)
        return reply.pressed
      }, accelerator),
    launcherVisible: async () => (await launcherWindow()).visible,
    launcherBounds: async () => (await launcherWindow()).bounds,
    perfLines: () => [...perf],
    close: () => app.close()
  }
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}
