import { z } from 'zod'
import type { Values } from 'prompt-lang'
import { JsonStore } from './json-store'
import { ValuesSchema } from './values-schema'

// Loose, so keys written by a newer version survive a save by an older one.
const StateSchema = z.looseObject({
  lastValues: z.record(z.string(), ValuesSchema).default({}),
  // Prompt ids. Favorites keep the order they were starred in; recents are most recent first.
  favorites: z.array(z.string()).default([]),
  recents: z.array(z.string()).default([])
})

type State = z.infer<typeof StateSchema>

/** Prompts whose last-used values are kept; the least recently used are dropped first. */
export const MAX_REMEMBERED_PROMPTS = 500

/** Prompts kept in the recently used list. */
export const MAX_RECENTS = 30

/**
 * What the app remembers between runs: the values last used with each prompt,
 * which prompts are favorites and which were used lately.
 * Kept in its own file in the app data folder, never in the prompt files.
 */
export class StateStore {
  private writes: Promise<void> = Promise.resolve()

  private constructor(
    private readonly store: JsonStore<State>,
    private current: State
  ) {}

  static async open(path: string): Promise<StateStore> {
    const store = new JsonStore<State>(path, StateSchema, () => StateSchema.parse({}))
    return new StateStore(store, await store.load())
  }

  lastValues(promptId: string): Values {
    // Own keys only: a prompt called `constructor` or `toString` must not find Object.prototype.
    const { lastValues } = this.current
    return Object.hasOwn(lastValues, promptId) ? (lastValues[promptId] ?? {}) : {}
  }

  /** Starred prompt ids, in the order they were starred. */
  favorites(): readonly string[] {
    return this.current.favorites
  }

  /** Prompt ids, most recently used first. */
  recents(): readonly string[] {
    return this.current.recents
  }

  isFavorite(promptId: string): boolean {
    return this.current.favorites.includes(promptId)
  }

  /** Stars or unstars a prompt. Returns whether it is a favorite now. */
  async toggleFavorite(promptId: string): Promise<boolean> {
    const favorite = !this.isFavorite(promptId)
    await this.update((state) => ({
      ...state,
      favorites: favorite
        ? [...state.favorites, promptId]
        : state.favorites.filter((id) => id !== promptId)
    }))
    return favorite
  }

  /** Moves a prompt to the front of the recently used list. */
  markUsed(promptId: string): Promise<void> {
    return this.update((state) => ({
      ...state,
      recents: [promptId, ...state.recents.filter((id) => id !== promptId)].slice(0, MAX_RECENTS)
    }))
  }

  /** Replaces what is remembered for a prompt. An empty set forgets it. */
  remember(promptId: string, values: Values): Promise<void> {
    return this.update((state) => {
      const others = Object.entries(state.lastValues).filter(([id]) => id !== promptId)
      const lastValues =
        Object.keys(values).length === 0
          ? Object.fromEntries(others)
          : Object.fromEntries(
              [...others, [promptId, values] as const].slice(-MAX_REMEMBERED_PROMPTS)
            )
      return { ...state, lastValues }
    })
  }

  /** Applies a change to the latest state and saves it. One at a time, so quick changes can't overwrite each other. */
  private update(change: (state: State) => State): Promise<void> {
    const write = this.writes.then(async () => {
      const next = change(this.current)
      await this.store.save(next)
      this.current = next
    })
    this.writes = write.catch(() => undefined)
    return write
  }
}
