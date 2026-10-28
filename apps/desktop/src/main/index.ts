import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { handle } from './ipc'
import { quitWhenMainWindowCloses } from './platform'
import { applySecurityPolicy, type TrustedOrigins } from './security'
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

function registerIpc(): void {
  handle(origins, 'app:get-info', z.tuple([]), () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }))
}

void app.whenReady().then(() => {
  applySecurityPolicy(origins)
  registerIpc()
  openMainWindow()
  createLauncherWindow(devServerUrl)

  app.on('activate', () => {
    if (mainWindow === null) openMainWindow()
    else mainWindow.show()
  })
})
