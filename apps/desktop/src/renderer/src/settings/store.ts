import { create } from 'zustand'
import type { SettingsView } from '../../../shared/ipc'

/** How the last shortcut change went, to show next to the shortcut. */
export type ShortcutNote = { kind: 'saved' | 'warning' | 'error'; text: string }

interface SettingsStore {
  view: SettingsView | null
  /** Whether the settings dialog is showing. */
  open: boolean
  note: ShortcutNote | null
  /** Loads the settings and keeps them current. Returns a cleanup function. */
  start: () => () => void
  show: () => void
  hide: () => void
  setHotkey: (accelerator: string) => Promise<void>
  resetHotkey: () => Promise<void>
  setLaunchAtLogin: (enabled: boolean) => Promise<void>
}

export const useSettings = create<SettingsStore>()((set, get) => ({
  view: null,
  open: false,
  note: null,

  start() {
    const api = window.api
    const offs = [
      api.onSettingsChanged((view) => set({ view })),
      api.onOpenSettings(() => get().show())
    ]
    void api.getSettings().then((view) => set({ view }))
    return () => offs.forEach((off) => off())
  },

  show: () => set({ open: true, note: null }),
  hide: () => set({ open: false }),

  async setHotkey(accelerator) {
    try {
      const result = await window.api.setLauncherHotkey(accelerator)
      set({ view: result.settings })
      if (!result.ok) set({ note: { kind: 'error', text: result.error } })
      else if (result.warning !== null) set({ note: { kind: 'warning', text: result.warning } })
      else set({ note: { kind: 'saved', text: 'Shortcut changed.' } })
    } catch (error) {
      set({
        note: {
          kind: 'error',
          text: `Couldn’t change the shortcut: ${error instanceof Error ? error.message : String(error)}`
        }
      })
    }
  },

  async resetHotkey() {
    const view = get().view
    if (view !== null) await get().setHotkey(view.defaultLauncherHotkey)
  },

  async setLaunchAtLogin(enabled) {
    try {
      set({ view: await window.api.setLaunchAtLogin(enabled) })
    } catch {
      set({ note: { kind: 'error', text: 'Couldn’t change the start-at-login setting.' } })
    }
  }
}))
