import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { broadcast, handle } from './ipc'
import { Library } from './library/library'
import { chokidarWatch } from './library/watcher'
import { LibraryService } from './library-service'
import { quitWhenMainWindowCloses } from './platform'
import { applySecurityPolicy, type TrustedOrigins } from './security'
import { MiniSearchIndex } from './search/minisearch-index'
import { SettingsStore } from './settings'
import { createLauncherWindow, createMainWindow } from './windows'

const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

const origins: TrustedOrigins = {
  devServerUrl,
  rendererDirUrl: pathToFileURL(join(__dirname, '../renderer')).href
}

let mainWindow: BrowserWindow | null = null

function openMainWindow(): void {
  mainWindow = createMainWindow(devServerUrl)
  mainWindow.on('closed', () => {
    mainWindow = null
    if (quitWhenMainWindowCloses()) app.quit()
  })
}

async function pickFolder(): Promise<string | null> {
  const options = {
    title: 'Choose your prompt library folder',
    properties: [
      'openDirectory',
      'createDirectory'
    ] satisfies Electron.OpenDialogOptions['properties']
  }
  const parent = BrowserWindow.getFocusedWindow() ?? mainWindow
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

function registerIpc(library: LibraryService): void {
  const none = z.tuple([])
  // Every library channel waits for the saved library to finish loading, so a
  // window opened at startup never sees a half-loaded state.
  const ready =
    <T>(fn: () => T | Promise<T>) =>
    async (): Promise<T> => {
      await library.whenReady()
      return fn()
    }

  handle(origins, 'app:get-info', none, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }))
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
  handle(origins, 'library:get-prompt', z.tuple([z.string().min(1).max(1000)]), async (id) => {
    await library.whenReady()
    return library.detail(id)
  })
  handle(origins, 'library:search', z.tuple([z.string().max(500)]), async (query) => {
    await library.whenReady()
    return library.search(query)
  })
}

void app.whenReady().then(async () => {
  applySecurityPolicy(origins)

  const settings = await SettingsStore.open(join(app.getPath('userData'), 'settings.json'))
  const library = new Library({ search: new MiniSearchIndex(), watch: chokidarWatch })
  const service = new LibraryService({
    settings,
    library,
    defaultPath: join(app.getPath('documents'), app.getName()),
    pickFolder
  })
  service.onChange(() => broadcast('library:changed', { revision: service.version }))
  app.on('before-quit', () => void library.close())

  registerIpc(service)
  void service.start()
  openMainWindow()
  createLauncherWindow(devServerUrl)

  app.on('activate', () => {
    if (mainWindow === null) openMainWindow()
    else mainWindow.show()
  })
})
