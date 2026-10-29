// Platform-specific behavior lives here so other modules stay platform-neutral.
// Only macOS has been tried so far (see "Open questions" in CLAUDE.md); the
// other branches are the documented Electron behavior, not yet tested.

import {
  app,
  nativeTheme,
  type BrowserWindow,
  type BrowserWindowConstructorOptions
} from 'electron'
import { LAUNCHER_INITIAL_HEIGHT, LAUNCHER_WIDTH } from './launcher-geometry'

export const isMac = process.platform === 'darwin'
export const isWindows = process.platform === 'win32'

/** Whether the app can be started at login. Electron has no login-item API on Linux. */
export const launchAtLoginSupported = isMac || isWindows

/** Passed to the app by a Windows login item, so a login start can be told apart from a normal one. */
const LOGIN_ARG = '--started-at-login'

/**
 * Whether the system started the app at login, in which case it should stay in
 * the menu bar or tray without opening its main window.
 */
export function startedAtLogin(): boolean {
  if (isMac) return app.getLoginItemSettings().wasOpenedAtLogin
  return process.argv.includes(LOGIN_ARG)
}

/** Adds or removes the login item. Only meaningful for an installed app, so the caller checks that. */
export function setLaunchAtLogin(enabled: boolean): void {
  if (!launchAtLoginSupported) return
  app.setLoginItemSettings({ openAtLogin: enabled, args: isMac ? [] : [LOGIN_ARG] })
}

/** Whether the system has the app set to start at login right now. */
export function isLaunchAtLoginEnabled(): boolean {
  return launchAtLoginSupported && app.getLoginItemSettings().openAtLogin
}

/**
 * The quick launcher's window: frameless, always on top, out of the taskbar and
 * window switchers. On macOS it is a panel, which is what lets it appear over
 * full-screen apps and take the keyboard without making Promptweaver the active app.
 */
export function launcherWindowOptions(): BrowserWindowConstructorOptions {
  return {
    title: app.getName(),
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_INITIAL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    // The system rounds the corners of a frameless window (macOS, Windows 11); the page doesn't.
    roundedCorners: true,
    ...(isMac
      ? {
          type: 'panel' as const,
          // Frosted glass: macOS blurs what is behind the window, and the page tints it.
          // The window must be transparent, or its own backing hides the effect.
          transparent: true,
          vibrancy: 'popover' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000'
        }
      : // Elsewhere the window is the page's solid background, so it matches the page's surface.
        { backgroundColor: launcherBackground() })
  }
}

/** The launcher surface's color (see `.launcher-surface` in styles.css), by the system's light or dark setting. */
function launcherBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff'
}

/** One-time setup after the launcher window exists. */
export function configureLauncherWindow(win: BrowserWindow): void {
  // With vibrancy (macOS) the window stays clear; elsewhere it follows the light or dark setting.
  if (!isMac) {
    nativeTheme.on('updated', () => {
      if (!win.isDestroyed()) win.setBackgroundColor(launcherBackground())
    })
  }
  // Above everything, including full-screen apps' windows.
  win.setAlwaysOnTop(true, 'screen-saver')
  if (isMac) {
    // Show on whichever desktop or full-screen space is active, not the one it was created on.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // That call can hide the Dock icon; the main window is a normal window, so the Dock icon stays.
    void app.dock?.show()
  }
}

/** Shows the launcher and gives it the keyboard. */
export function showLauncherWindow(win: BrowserWindow): void {
  win.show()
  win.focus()
}

/** Hides the launcher so focus goes back to the app the user was in. */
export function hideLauncherWindow(win: BrowserWindow): void {
  win.hide()
}
