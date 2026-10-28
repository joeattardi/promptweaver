import { stat } from 'node:fs/promises'
import type {
  AliasConflict,
  LibraryProblem,
  PromptDetail,
  PromptSummary
} from '../../shared/library'
import type { SearchIndex } from '../search/types'
import { aliasKey, buildEntry, toDetail, toIndexed, toSummary, type PromptEntry } from './entry'
import { idFromPath } from './prompt-id'
import { describeError, displayPath, readPromptFile, scanLibrary } from './scan'
import type { WatchFactory, WatchHandle } from './watcher'

export interface LibrarySnapshot {
  prompts: PromptSummary[]
  problems: LibraryProblem[]
  aliasConflicts: AliasConflict[]
}

export interface LibraryDeps {
  search: SearchIndex
  watch: WatchFactory
  /** How long to collect file events before applying them. */
  debounceMs?: number
}

/** The library folder can't be used; `message` is fit to show the user. */
export class LibraryError extends Error {
  override name = 'LibraryError'
}

const READ_BATCH = 64

/**
 * The prompts in one library folder, held in memory: parsed files, the search
 * index, and a watcher that keeps both current. Owned by the main process;
 * windows only ever see plain summaries.
 */
export class Library {
  private root: string | null = null
  private entries = new Map<string, PromptEntry>()
  private problems = new Map<string, LibraryProblem>()
  private conflicts: Map<string, string[]> | null = null
  private handle: WatchHandle | null = null
  private generation = 0
  private revision = 0
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()
  private loading: Promise<void> = Promise.resolve()
  private failure: string | null = null
  private readonly listeners = new Set<() => void>()

  constructor(private readonly deps: LibraryDeps) {}

  get path(): string | null {
    return this.root
  }

  /** Set when the folder disappeared while the app was running. */
  get error(): string | null {
    return this.failure
  }

  /** Increases whenever the library changes. */
  get version(): number {
    return this.revision
  }

  /** Calls `listener` after any change to the library. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Loads the folder, builds the search index and starts watching. Throws LibraryError if the folder can't be used. */
  async open(root: string): Promise<void> {
    await this.close()
    const generation = ++this.generation
    this.root = root
    this.failure = null
    this.reset()

    try {
      if (!(await stat(root)).isDirectory()) throw new LibraryError('This is not a folder.')
    } catch (error) {
      this.root = null
      throw error instanceof LibraryError ? error : new LibraryError(describeError(error))
    }

    // Watch before scanning, so a change made during the scan is never missed.
    // Events that arrive meanwhile wait in `pending` until the scan is done.
    try {
      this.handle = await this.deps.watch(root, {
        onEvent: (event) => this.noteChange(event.path, generation),
        onError: (error) => console.warn('Library watcher error:', error)
      })
    } catch (error) {
      this.root = null
      throw new LibraryError(`Can't watch this folder: ${describeError(error)}`)
    }

    this.loading = this.load(root, generation)
    try {
      await this.loading
    } catch (error) {
      await this.close()
      this.root = null
      throw new LibraryError(describeError(error))
    }
    this.changed()
  }

  /** Stops watching and forgets the folder. */
  async close(): Promise<void> {
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
    const handle = this.handle
    this.handle = null
    await handle?.close()
    await this.queue
    this.root = null
    this.failure = null
    this.reset()
  }

  /** Waits until file events seen so far have been applied. */
  async settled(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.flush()
    }
    await this.queue
  }

  /**
   * Re-reads these files now, without waiting for the watcher to notice them.
   * Used after the app itself writes a file, so the very next read is current.
   */
  async refresh(paths: string[]): Promise<void> {
    for (const path of paths) this.noteChange(path, this.generation)
    await this.settled()
  }

  snapshot(): LibrarySnapshot {
    const conflicted = this.conflictedAliases()
    const prompts = [...this.entries.values()]
      .map((entry) => toSummary(entry, conflicted))
      .sort(compareSummaries)
    const aliasConflicts = [...this.aliasMap()]
      .filter(([, ids]) => ids.length > 1)
      .map(([alias, ids]) => ({ alias, ids: [...ids].sort() }))
      .sort((a, b) => a.alias.localeCompare(b.alias))
    const problems = [...this.problems.values()].sort((a, b) => a.file.localeCompare(b.file))
    return { prompts, problems, aliasConflicts }
  }

  detail(id: string): PromptDetail | null {
    const entry = this.entries.get(id)
    return entry ? toDetail(entry, toSummary(entry, this.conflictedAliases())) : null
  }

  /** The parsed prompt with this id, or null if there is none. */
  entry(id: string): PromptEntry | null {
    return this.entries.get(id) ?? null
  }

  /** Best matches first, with an exact alias match always on top. */
  search(query: string, limit?: number): PromptSummary[] {
    const conflicted = this.conflictedAliases()
    const results: PromptSummary[] = []
    for (const { id } of this.deps.search.search(query, limit === undefined ? {} : { limit })) {
      const entry = this.entries.get(id)
      if (entry) results.push(toSummary(entry, conflicted))
    }
    return results
  }

  // ---------------------------------------------------------------------------

  private reset(): void {
    this.entries.clear()
    this.problems.clear()
    this.conflicts = null
    this.deps.search.index([])
  }

  private async load(root: string, generation: number): Promise<void> {
    const { files, problems } = await scanLibrary(root)
    if (generation !== this.generation) return
    for (const p of problems) {
      this.problems.set(p.path, { file: displayPath(root, p.path), message: p.message })
    }
    for (let i = 0; i < files.length; i += READ_BATCH) {
      const batch = files.slice(i, i + READ_BATCH)
      const loaded = await Promise.all(
        batch.map(async (path) => ({ path, read: await readPromptFile(path) }))
      )
      if (generation !== this.generation) return
      for (const { path, read } of loaded) this.apply(root, path, read)
    }
    this.deps.search.index([...this.entries.values()].map(toIndexed))
    this.conflicts = null
  }

  /** Records one file's current state. Returns whether anything changed. */
  private apply(
    root: string,
    path: string,
    read: Awaited<ReturnType<typeof readPromptFile>>
  ): boolean {
    const id = idFromPath(root, path)
    if (id === null) return false
    const known = this.entries.get(id)
    switch (read.kind) {
      case 'ok': {
        const hadProblem = this.problems.delete(path)
        if (known?.text === read.text) return hadProblem
        const entry = buildEntry(id, read.text)
        this.entries.set(id, entry)
        this.deps.search.update(toIndexed(entry))
        return true
      }
      case 'missing': {
        const hadProblem = this.problems.delete(path)
        if (!known) return hadProblem
        this.entries.delete(id)
        this.deps.search.remove(id)
        return true
      }
      case 'unreadable': {
        const message = this.problems.get(path)?.message
        this.problems.set(path, { file: displayPath(root, path), message: read.message })
        if (known) {
          this.entries.delete(id)
          this.deps.search.remove(id)
          return true
        }
        return message !== read.message
      }
    }
  }

  private noteChange(path: string, generation: number): void {
    if (generation !== this.generation || this.root === null) return
    if (idFromPath(this.root, path) === null) return
    this.pending.add(path)
    this.timer ??= setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.deps.debounceMs ?? 60)
  }

  private flush(): void {
    const paths = [...this.pending]
    this.pending.clear()
    const generation = this.generation
    if (paths.length === 0) return
    this.queue = this.queue
      .then(async () => {
        await this.loading.catch(() => undefined)
        await this.applyPaths(paths, generation)
      })
      // One bad batch must not wedge the queue that close() waits on.
      .catch((error: unknown) => console.warn('Library update failed:', error))
  }

  private async applyPaths(paths: string[], generation: number): Promise<void> {
    const root = this.root
    if (root === null || generation !== this.generation) return
    let changed = false
    let sawMissing = false
    for (const path of paths) {
      const read = await readPromptFile(path)
      if (generation !== this.generation) return
      if (read.kind === 'missing') sawMissing = true
      if (this.apply(root, path, read)) changed = true
    }
    if (
      sawMissing &&
      !(await stat(root).then(
        (s) => s.isDirectory(),
        () => false
      ))
    ) {
      if (generation !== this.generation) return
      this.failure = 'The library folder is missing or can no longer be read.'
      this.reset()
      changed = true
    }
    if (changed) {
      this.conflicts = null
      this.changed()
    }
  }

  private changed(): void {
    this.revision++
    for (const listener of this.listeners) listener()
  }

  /** Lower-cased alias to the ids that declare it. */
  private aliasMap(): Map<string, string[]> {
    if (this.conflicts) return this.conflicts
    const map = new Map<string, string[]>()
    for (const entry of this.entries.values()) {
      for (const key of new Set(entry.aliases.map(aliasKey))) {
        map.set(key, [...(map.get(key) ?? []), entry.id])
      }
    }
    this.conflicts = map
    return map
  }

  private conflictedAliases(): Set<string> {
    return new Set([...this.aliasMap()].filter(([, ids]) => ids.length > 1).map(([alias]) => alias))
  }
}

function compareSummaries(a: PromptSummary, b: PromptSummary): number {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  if (a.folder !== b.folder) {
    if (a.folder === '') return -1
    if (b.folder === '') return 1
    return collator.compare(a.folder, b.folder)
  }
  return collator.compare(a.title, b.title) || collator.compare(a.id, b.id)
}
