import { app, Menu, nativeImage, Tray } from 'electron'
import { formatAccelerator } from '../shared/accelerator'
import { isMac } from './platform'
import { weaveIconPng } from './tray-icon'

export interface TrayActions {
  openLauncher(): void
  newFromClipboard(): void
  openLibrary(): void
  openSettings(): void
}

export interface TrayState {
  /** The shortcut that is registered, or null if none is. */
  accelerator: string | null
}

/** The menu-bar (macOS) or notification-area icon: how the app stays reachable with no window open. */
export class AppTray {
  private readonly tray: Tray

  constructor(
    private readonly actions: TrayActions,
    state: TrayState
  ) {
    const png = weaveIconPng(36, isMac ? [0, 0, 0] : [79, 70, 229])
    const icon = nativeImage.createFromBuffer(png, { scaleFactor: 2 })
    // A template image is drawn by macOS in the right color for light and dark menu bars.
    icon.setTemplateImage(isMac)
    this.tray = new Tray(icon)
    this.tray.setToolTip(app.getName())
    this.update(state)
  }

  /** Rebuilds the menu, for when the shortcut changes. */
  update(state: TrayState): void {
    const { accelerator } = state
    const menu = Menu.buildFromTemplate([
      {
        label: accelerator === null ? 'Open Launcher (no shortcut set)' : 'Open Launcher',
        // Shown beside the item as a reminder; the global shortcut itself is registered elsewhere.
        ...(accelerator === null ? {} : { accelerator, registerAccelerator: false }),
        click: () => this.actions.openLauncher()
      },
      { label: 'New Prompt from Clipboard', click: () => this.actions.newFromClipboard() },
      { type: 'separator' },
      { label: 'Open Library', click: () => this.actions.openLibrary() },
      { label: 'Settings…', click: () => this.actions.openSettings() },
      { type: 'separator' },
      { label: `Quit ${app.getName()}`, role: 'quit' }
    ])
    this.tray.setContextMenu(menu)
    this.tray.setToolTip(
      accelerator === null
        ? app.getName()
        : `${app.getName()} (${formatAccelerator(accelerator, process.platform)})`
    )
  }

  destroy(): void {
    this.tray.destroy()
  }
}
