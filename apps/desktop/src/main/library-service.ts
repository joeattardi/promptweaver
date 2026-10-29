import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryActionResult, LibraryState } from '../shared/ipc'
import type { PromptDetail, PromptSummary } from '../shared/library'
import { LibraryError, type Library } from './library/library'
import { describeError, scanLibrary } from './library/scan'
import type { SettingsStore } from './settings'
import { writeStarters } from './starters'

export interface LibraryServiceDeps {
  settings: SettingsStore
  library: Library
  /** Where "Create library" on the welcome screen puts it. */
  defaultPath: string
  /** Shows a folder picker. Null if the user cancelled. */
  pickFolder: () => Promise<string | null>
}

const SEARCH_LIMIT = 50

/**
 * What the windows can do with the library: the first-run choice, picking a
 * folder, adding starter prompts, and reading and searching. It owns the
 * saved folder setting; the Library owns the prompts.
 */
export class LibraryService {
  private openError: string | null = null
  private loaded = false
  private revision = 0
  private started: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly deps: LibraryServiceDeps) {
    deps.library.onChange(() => this.bump())
  }

  /** Opens the saved library, if there is one. Never rejects: a problem becomes an `error` state. */
  start(): Promise<void> {
    this.loaded = false
    this.started = this.openSaved().finally(() => {
      this.loaded = true
    })
    return this.started
  }

  /** Resolves once the saved library has been loaded (or failed to). */
  whenReady(): Promise<void> {
    return this.started
  }

  get version(): number {
    return this.revision
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  state(): LibraryState {
    const { library, defaultPath } = this.deps
    const base = { revision: this.revision, defaultPath }
    const health = this.health()
    if (health.status === 'ready') {
      return { status: 'ready', path: health.path, ...library.snapshot(), ...base }
    }
    return { ...health, ...base }
  }

  /** How the library is doing, without building the prompt list. 'loading' until the saved folder has been read. */
  status(): 'loading' | 'unconfigured' | 'error' | 'ready' {
    return this.loaded ? this.health().status : 'loading'
  }

  /** Every prompt, in library order. Empty unless the library is ready. */
  prompts(): PromptSummary[] {
    return this.health().status === 'ready' ? this.deps.library.snapshot().prompts : []
  }

  /** The folder in use, or null if there is none. */
  get path(): string | null {
    return this.health().status === 'ready' ? this.deps.library.path : null
  }

  /** Re-reads these files now, so a file the app just wrote is in the library before anyone asks. */
  refresh(paths: string[]): Promise<void> {
    return this.deps.library.refresh(paths)
  }

  detail(id: string): PromptDetail | null {
    return this.deps.library.detail(id)
  }

  search(query: string): PromptSummary[] {
    return this.deps.library.search(query, SEARCH_LIMIT)
  }

  /** Lets the user pick a folder to use as the library. Nothing in it is touched. */
  async chooseFolder(): Promise<LibraryActionResult> {
    const picked = await this.deps.pickFolder()
    if (picked === null) return this.result(null)
    return this.use(picked)
  }

  /**
   * The welcome screen's "Create library": makes the default folder and, if it
   * has no prompts yet, fills it with the starters. A folder that already
   * has prompts is used as it is.
   */
  async createDefault(): Promise<LibraryActionResult> {
    const { defaultPath } = this.deps
    try {
      await mkdir(defaultPath, { recursive: true })
      const existing = await scanLibrary(defaultPath)
      if (existing.files.length === 0) await writeStarters(defaultPath)
    } catch (error) {
      return this.fail(`Couldn't create ${defaultPath}: ${describeError(error)}`)
    }
    return this.use(defaultPath)
  }

  /** Adds any starter prompts that are missing from the current library. Existing files are never touched. */
  async addStarters(): Promise<LibraryActionResult> {
    const path = this.deps.library.path
    if (path === null) return this.fail('Choose a library folder first.')
    try {
      const { created } = await writeStarters(path)
      await this.deps.library.refresh(created.map((file) => join(path, file)))
    } catch (error) {
      return this.fail(`Couldn't add the starter prompts: ${describeError(error)}`)
    }
    return this.result(null)
  }

  // ---------------------------------------------------------------------------

  private health():
    | { status: 'unconfigured' }
    | { status: 'error'; path: string; message: string }
    | { status: 'ready'; path: string } {
    const { library, settings } = this.deps
    const path = settings.get().libraryPath
    if (path === null) return { status: 'unconfigured' }
    const message = this.openError ?? library.error
    if (message !== null || library.path !== path) {
      return {
        status: 'error',
        path,
        message: message ?? 'The library folder could not be opened.'
      }
    }
    return { status: 'ready', path }
  }

  private async openSaved(): Promise<void> {
    const path = this.deps.settings.get().libraryPath
    if (path === null) return
    try {
      await this.deps.library.open(path)
    } catch (error) {
      this.openError = error instanceof LibraryError ? error.message : describeError(error)
    }
    this.bump()
  }

  /** Switches to `path`. If it can't be opened, the previous library stays in place. */
  private async use(path: string): Promise<LibraryActionResult> {
    const { library, settings } = this.deps
    const previous = settings.get().libraryPath
    try {
      await library.open(path)
    } catch (error) {
      const reason = error instanceof LibraryError ? error.message : describeError(error)
      if (previous === path) {
        this.openError = reason
      } else if (previous !== null) {
        await library.open(previous).catch((e: unknown) => {
          this.openError = e instanceof LibraryError ? e.message : describeError(e)
        })
      }
      return this.fail(`Couldn't open ${path}: ${reason}`)
    }
    await settings.update({ libraryPath: path })
    this.openError = null
    return this.result(null)
  }

  private fail(error: string): LibraryActionResult {
    return this.result(error)
  }

  private result(error: string | null): LibraryActionResult {
    this.bump()
    return { state: this.state(), error }
  }

  private bump(): void {
    this.revision++
    for (const listener of this.listeners) listener()
  }
}
