import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { configureLauncherWindow, launcherWindowOptions } from './platform'

export type Page = 'index' | 'launcher'

const preloadPath = join(__dirname, '../preload/index.js')

function secureWebPreferences(): Electron.WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false
  }
}

function loadPage(win: BrowserWindow, page: Page, devServerUrl: string | undefined): void {
  if (devServerUrl !== undefined) {
    void win.loadURL(`${devServerUrl}/${page}.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`))
  }
}

/** Keep the window title as the app name (from package.json), not the page's <title>. */
function lockTitle(win: BrowserWindow): void {
  win.on('page-title-updated', (event) => event.preventDefault())
}

export function createMainWindow(
  devServerUrl: string | undefined,
  options: { show: boolean }
): BrowserWindow {
  const win = new BrowserWindow({
    title: app.getName(),
    width: 1000,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences()
  })
  lockTitle(win)
  if (options.show) win.once('ready-to-show', () => win.show())
  loadPage(win, 'index', devServerUrl)
  return win
}

/**
 * The quick launcher window. Created once at startup and kept hidden; the
 * launcher controller shows, hides and positions it.
 */
export function createLauncherWindow(devServerUrl: string | undefined): BrowserWindow {
  const win = new BrowserWindow({
    ...launcherWindowOptions(),
    webPreferences: {
      ...secureWebPreferences(),
      // The page keeps rendering while hidden, so it is already drawn the moment it is shown.
      backgroundThrottling: false
    }
  })
  lockTitle(win)
  configureLauncherWindow(win)
  loadPage(win, 'launcher', devServerUrl)
  return win
}
