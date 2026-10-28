import { z } from 'zod'
import type { Values } from 'prompt-lang'
import { JsonStore } from './json-store'
import { ValuesSchema } from './values-schema'

// Loose, so keys written by a newer version survive a save by an older one.
const StateSchema = z.looseObject({
  lastValues: z.record(z.string(), ValuesSchema).default({})
})

type State = z.infer<typeof StateSchema>

/** Prompts whose last-used values are kept; the least recently used are dropped first. */
export const MAX_REMEMBERED_PROMPTS = 500

/**
 * What the app remembers between runs: the values last used with each prompt.
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

  /** Replaces what is remembered for a prompt. An empty set forgets it. */
  remember(promptId: string, values: Values): Promise<void> {
    // One write at a time, so two quick copies can't overwrite each other's change.
    const write = this.writes.then(() => this.write(promptId, values))
    this.writes = write.catch(() => undefined)
    return write
  }

  private async write(promptId: string, values: Values): Promise<void> {
    const others = Object.entries(this.current.lastValues).filter(([id]) => id !== promptId)
    const lastValues =
      Object.keys(values).length === 0
        ? Object.fromEntries(others)
        : Object.fromEntries(
            [...others, [promptId, values] as const].slice(-MAX_REMEMBERED_PROMPTS)
          )
    const next = { ...this.current, lastValues }
    await this.store.save(next)
    this.current = next
  }
}
