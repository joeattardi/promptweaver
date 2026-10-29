import { app, BrowserWindow, clipboard, dialog, globalShortcut } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_LAUNCHER_HOTKEY } from '../shared/accelerator'
import { CaptureService } from './capture-service'
import { FillService } from './fill-service'
import { HotkeyManager } from './hotkey'
import { broadcast } from './ipc'
import { newPromptFromClipboard, registerIpc, type IpcDeps } from './ipc-handlers'
import { Library } from './library/library'
import { chokidarWatch } from './library/watcher'
import { LibraryService } from './library-service'
import { LauncherService } from './launcher-service'
import { LauncherController } from './launcher-window'
import { MainWindowController, type WindowHandle } from './main-window'
import {
  isLaunchAtLoginEnabled,
  isMac,
  launchAtLoginSupported,
  setLaunchAtLogin,
  startedAtLogin
} from './platform'
import { applySecurityPolicy, type TrustedOrigins } from './security'
import { MiniSearchIndex } from './search/minisearch-index'
import { SettingsStore } from './settings'
import { StateStore } from './state'
import { AppTray } from './tray'
import { createLauncherWindow, createMainWindow } from './windows'

const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

const origins: TrustedOrigins = {
  devServerUrl,
  rendererDirUrl: pathToFileURL(join(__dirname, '../renderer')).href
}

/** Timing of the launcher's hotkey-to-paint path: on when running from source, or with PROMPTWEAVER_PERF=1. */
const measurePerformance = !app.isPackaged || process.env['PROMPTWEAVER_PERF'] === '1'

// A second copy would fight the first for the global shortcut. Open the first one's window instead.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let mainBrowserWindow: BrowserWindow | null = null

function windowHandle(win: BrowserWindow): WindowHandle {
  return {
    isMinimized: () => win.isMinimized(),
    restore: () => win.restore(),
    show: () => win.show(),
    focus: () => win.focus(),
    send: (channel, payload) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    },
    onClosed: (listener) => win.once('closed', listener)
  }
}

async function pickFolder(): Promise<string | null> {
  const options = {
    title: 'Choose your prompt library folder',
    properties: [
      'openDirectory',
      'createDirectory'
    ] satisfies Electron.OpenDialogOptions['properties']
  }
  const parent = BrowserWindow.getFocusedWindow() ?? mainBrowserWindow
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

if (gotLock) {
  void app.whenReady().then(start)
}

async function start(): Promise<void> {
  applySecurityPolicy(origins)

  const settings = await SettingsStore.open(join(app.getPath('userData'), 'settings.json'))
  const state = await StateStore.open(join(app.getPath('userData'), 'state.json'))
  const library = new Library({ search: new MiniSearchIndex(), watch: chokidarWatch })
  const service = new LibraryService({
    settings,
    library,
    defaultPath: join(app.getPath('documents'), app.getName()),
    pickFolder
  })
  const launcherData = new LauncherService({ library: service, state })

  const main = new MainWindowController({
    create: ({ show }) => {
      const win = createMainWindow(devServerUrl, { show })
      mainBrowserWindow = win
      win.once('closed', () => {
        if (mainBrowserWindow === win) mainBrowserWindow = null
      })
      return windowHandle(win)
    },
    // From the tray or the launcher the app may be in the background; bring it forward.
    activateApp: () => {
      if (isMac) app.focus({ steal: true })
    }
  })

  const launcherWindow = createLauncherWindow(devServerUrl)
  const launcher = new LauncherController(launcherWindow, {
    suggestions: () => launcherData.suggestions(),
    readClipboard: () => clipboard.readText(),
    measure: measurePerformance,
    log: (message) => console.log(message)
  })

  /** Something the launcher shows changed: rebuild it now, off the hotkey path, and tell it if it is open. */
  const refreshLauncherData = (): void => {
    launcherData.invalidate()
    if (launcher.isVisible()) launcher.pushSuggestions()
    else setImmediate(() => launcherData.suggestions())
  }
  service.onChange(() => {
    broadcast('library:changed', { revision: service.version })
    refreshLauncherData()
  })
  app.on('before-quit', () => void library.close())

  const fill = new FillService({
    prompts: library,
    state,
    clipboard: {
      readText: async () => clipboard.readText(),
      writeText: async (text) => clipboard.writeText(text)
    },
    now: () => new Date(),
    onCopied: refreshLauncherData
  })
  const capture = new CaptureService({
    libraryPath: () => service.path,
    readClipboard: () => clipboard.readText(),
    refresh: (paths) => service.refresh(paths)
  })

  const hotkey = new HotkeyManager(globalShortcut, () => launcher.toggle(), process.platform)
  const saved = settings.get().launcherHotkey
  // A hand-edited or corrupt shortcut shouldn't leave the launcher unreachable.
  if (!hotkey.apply(saved).ok && saved !== DEFAULT_LAUNCHER_HOTKEY) {
    // The failure is kept as the status, so the main window tells the user why.
    console.warn(`Couldn't register the launcher shortcut ${saved}.`)
  }
  app.on('will-quit', () => hotkey.dispose())

  const loginItemAvailable = launchAtLoginSupported && app.isPackaged
  const deps: IpcDeps = {
    origins,
    appInfo: () => ({ name: app.getName(), version: app.getVersion(), platform: process.platform }),
    library: service,
    prompts: library,
    fill,
    capture,
    settings,
    state,
    hotkey,
    launcher,
    launcherData,
    main,
    loginItem: {
      available: loginItemAvailable,
      isEnabled: isLaunchAtLoginEnabled,
      set: setLaunchAtLogin
    },
    onHotkeyChanged: () => tray.update({ accelerator: hotkey.accelerator }),
    platform: process.platform
  }

  const tray = new AppTray(
    {
      openLauncher: () => void launcher.summon(),
      newFromClipboard: () => void newPromptFromClipboard(deps, 'tray'),
      openLibrary: () => main.open(),
      openSettings: () => main.open({ openSettings: true })
    },
    { accelerator: hotkey.accelerator }
  )
  app.on('will-quit', () => tray.destroy())

  registerIpc(deps)

  app.on('second-instance', () => main.open())
  app.on('activate', () => main.open())

  // Test hooks: the global shortcut can't be pressed from a test, so let the tests ask for it.
  if (process.env['PROMPTWEAVER_TEST_HOOKS'] === '1') {
    const hooks = app as unknown as NodeJS.EventEmitter
    hooks.on('promptweaver:summon', () => launcher.toggle())
  }

  void service.start()
  // Started by the system at login: stay in the menu bar, and leave the windows for later.
  if (startedAtLogin()) main.createHidden()
  else main.open()
}
