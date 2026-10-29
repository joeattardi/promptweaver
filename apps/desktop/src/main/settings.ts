import { z } from 'zod'
import { DEFAULT_LAUNCHER_HOTKEY } from '../shared/accelerator'
import { JsonStore } from './json-store'

// Loose, so keys written by a newer version survive a save by an older one.
const SettingsSchema = z.looseObject({
  libraryPath: z.string().min(1).nullable().default(null),
  /** Electron accelerator that summons the quick launcher. */
  launcherHotkey: z.string().min(1).default(DEFAULT_LAUNCHER_HOTKEY),
  launchAtLogin: z.boolean().default(false)
})

export type Settings = z.infer<typeof SettingsSchema>

/** App settings, cached in memory and persisted to one JSON file. */
export class SettingsStore {
  private constructor(
    private readonly store: JsonStore<Settings>,
    private current: Settings
  ) {}

  static async open(path: string): Promise<SettingsStore> {
    const store = new JsonStore<Settings>(path, SettingsSchema, () => SettingsSchema.parse({}))
    return new SettingsStore(store, await store.load())
  }

  get(): Settings {
    return this.current
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...this.current, ...patch }
    await this.store.save(next)
    this.current = next
    return next
  }
}
