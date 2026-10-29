import type { LauncherGroup, LauncherSuggestions, PromptSummary } from '../shared/ipc'

export interface LauncherServiceDeps {
  library: {
    status(): LauncherSuggestions['status']
    /** Every prompt, in library order. */
    prompts(): PromptSummary[]
  }
  state: {
    favorites(): readonly string[]
    recents(): readonly string[]
  }
}

/** Recently used prompts shown in the empty-search view. */
export const MAX_RECENT_SHOWN = 8
/** Prompts shown after favorites and recents, so the launcher is useful before anything is starred. */
export const MAX_REST_SHOWN = 100

/**
 * What the launcher shows before anything is typed. Built once per change and
 * kept, so summoning the launcher never waits on it.
 */
export class LauncherService {
  private cached: LauncherSuggestions | null = null

  constructor(private readonly deps: LauncherServiceDeps) {}

  /** Forget what was built: the library, the favorites or the recents changed. */
  invalidate(): void {
    this.cached = null
  }

  suggestions(): LauncherSuggestions {
    this.cached ??= this.build()
    return this.cached
  }

  private build(): LauncherSuggestions {
    const status = this.deps.library.status()
    if (status !== 'ready') return { status, groups: [], favoriteIds: [] }

    const prompts = this.deps.library.prompts()
    const byId = new Map(prompts.map((p) => [p.id, p]))
    const shown = new Set<string>()
    const take = (ids: readonly string[], limit: number): PromptSummary[] => {
      const taken: PromptSummary[] = []
      for (const id of ids) {
        const prompt = byId.get(id)
        // A prompt deleted or renamed since it was starred or used is simply skipped.
        if (prompt === undefined || shown.has(id)) continue
        shown.add(id)
        taken.push(prompt)
        if (taken.length === limit) break
      }
      return taken
    }

    const favoriteIds = this.deps.state.favorites().filter((id) => byId.has(id))
    const favorites = take(favoriteIds, Infinity)
    const recent = take(this.deps.state.recents(), MAX_RECENT_SHOWN)
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    const rest = take(
      [...prompts].sort((a, b) => collator.compare(a.title, b.title)).map((p) => p.id),
      MAX_REST_SHOWN
    )

    const groups: LauncherGroup[] = [
      { kind: 'favorites' as const, prompts: favorites },
      { kind: 'recent' as const, prompts: recent },
      { kind: 'all' as const, prompts: rest }
    ].filter((group) => group.prompts.length > 0)
    return { status, groups, favoriteIds }
  }
}
