import { z } from 'zod'
import { DEFAULT_LAUNCHER_HOTKEY, clashWarning } from '../shared/accelerator'
import type { CaptureResult, SettingsView } from '../shared/ipc'
import { captureProblem } from '../shared/capture'
import type { CaptureService } from './capture-service'
import type { FillService } from './fill-service'
import { broadcast, handle } from './ipc'
import type { Library } from './library/library'
import type { LibraryService } from './library-service'
import type { LauncherController } from './launcher-window'
import type { LauncherService } from './launcher-service'
import type { HotkeyManager } from './hotkey'
import type { MainWindowController } from './main-window'
import type { SettingsStore } from './settings'
import type { StateStore } from './state'
import type { TrustedOrigins } from './security'
import { ValuesSchema } from './values-schema'

export interface IpcDeps {
  origins: TrustedOrigins
  appInfo: () => { name: string; version: string; platform: string }
  library: LibraryService
  prompts: Pick<Library, 'entry'>
  fill: FillService
  capture: CaptureService
  settings: SettingsStore
  state: StateStore
  hotkey: HotkeyManager
  launcher: LauncherController
  launcherData: LauncherService
  main: MainWindowController
  /** What the system says about the login item, or null where it can't be changed from here. */
  loginItem: { available: boolean; isEnabled: () => boolean; set: (enabled: boolean) => void }
  onHotkeyChanged: () => void
  platform: NodeJS.Platform
}

const id = z.string().min(1).max(1000)
const none = z.tuple([])

export function settingsView(deps: IpcDeps): SettingsView {
  const { settings, hotkey, loginItem } = deps
  return {
    launcherHotkey: hotkey.accelerator ?? settings.get().launcherHotkey,
    defaultLauncherHotkey: DEFAULT_LAUNCHER_HOTKEY,
    hotkey: hotkey.status(),
    launchAtLogin: loginItem.available ? loginItem.isEnabled() : settings.get().launchAtLogin,
    launchAtLoginAvailable: loginItem.available,
    platform: deps.platform
  }
}

/** Saves the clipboard as a prompt and, if that worked, shows it in the main window. */
export async function newPromptFromClipboard(
  deps: IpcDeps,
  source: 'tray' | 'window'
): Promise<CaptureResult> {
  const result = await deps.capture.createFromClipboard()
  if (result.status === 'created') {
    deps.launcher.hide()
    deps.main.open({ selectId: result.id })
  } else if (source === 'tray') {
    // From the tray there is no window to say what went wrong, so open the main window to say it.
    const problem = captureProblem(result)
    if (problem !== null) deps.main.open({ notice: problem })
  }
  return result
}

export function registerIpc(deps: IpcDeps): void {
  const { origins, library, fill, settings, state, hotkey, launcher, main, loginItem } = deps

  // Every library channel waits for the saved library to finish loading, so a
  // window opened at startup never sees a half-loaded state.
  const ready =
    <T>(fn: () => T | Promise<T>) =>
    async (): Promise<T> => {
      await library.whenReady()
      return fn()
    }

  handle(origins, 'app:get-info', none, () => deps.appInfo())
  handle(origins, 'app:take-pending', none, () => main.takePending())
  handle(
    origins,
    'library:get-state',
    none,
    ready(() => library.state())
  )
  handle(
    origins,
    'library:choose-folder',
    none,
    ready(() => library.chooseFolder())
  )
  handle(
    origins,
    'library:create-default',
    none,
    ready(() => library.createDefault())
  )
  handle(
    origins,
    'library:add-starters',
    none,
    ready(() => library.addStarters())
  )
  handle(origins, 'library:get-prompt', z.tuple([id]), async (promptId) => {
    await library.whenReady()
    return library.detail(promptId)
  })
  handle(origins, 'library:search', z.tuple([z.string().max(500)]), async (query) => {
    await library.whenReady()
    return library.search(query)
  })

  handle(origins, 'fill:open', z.tuple([id]), async (promptId) => {
    await library.whenReady()
    return fill.open(promptId)
  })
  handle(origins, 'fill:read-clipboard', none, () => fill.readClipboard())
  handle(
    origins,
    'fill:copy',
    z.tuple([id, ValuesSchema, z.string().max(5_000_000)]),
    async (promptId, values, text) => {
      await library.whenReady()
      return fill.copy(promptId, values, text)
    }
  )

  handle(origins, 'prompt:new-from-clipboard', none, () => newPromptFromClipboard(deps, 'window'))

  handle(origins, 'favorites:list', none, () => [...state.favorites()])
  handle(origins, 'favorites:toggle', z.tuple([id]), async (promptId) => {
    // A prompt that is gone can still be un-starred, but not newly starred.
    if (state.isFavorite(promptId) || deps.prompts.entry(promptId) !== null) {
      await state.toggleFavorite(promptId)
    }
    const ids = [...state.favorites()]
    deps.launcherData.invalidate()
    broadcast('favorites:changed', { ids })
    return ids
  })

  handle(origins, 'settings:get', none, () => settingsView(deps))
  handle(origins, 'settings:set-hotkey', z.tuple([z.string().min(1).max(100)]), async (text) => {
    const result = hotkey.apply(text)
    if (!result.ok) return { ok: false, error: result.error, settings: settingsView(deps) }
    await settings.update({ launcherHotkey: result.accelerator })
    deps.onHotkeyChanged()
    const view = settingsView(deps)
    broadcast('settings:changed', view)
    return {
      ok: true,
      warning: clashWarning(result.accelerator, deps.platform),
      settings: view
    }
  })
  handle(origins, 'settings:set-launch-at-login', z.tuple([z.boolean()]), async (enabled) => {
    if (loginItem.available) loginItem.set(enabled)
    await settings.update({ launchAtLogin: enabled })
    const view = settingsView(deps)
    broadcast('settings:changed', view)
    return view
  })

  handle(origins, 'launcher:hide', none, () => {
    launcher.hide()
    return undefined
  })
  handle(origins, 'launcher:resize', z.tuple([z.number().finite()]), (height) => {
    launcher.resize(height)
    return undefined
  })
  handle(origins, 'launcher:open-in-main', z.tuple([id]), (promptId) => {
    launcher.hide()
    main.open({ selectId: promptId })
    return undefined
  })
  handle(origins, 'launcher:open-main', none, () => {
    launcher.hide()
    main.open()
    return undefined
  })
  handle(origins, 'launcher:report-paint', z.tuple([z.number().finite()]), (ms) => {
    launcher.recordPaint(ms)
    return undefined
  })
}
