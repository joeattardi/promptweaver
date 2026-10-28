// Platform-specific behavior lives here so other modules stay platform-neutral.

export const isMac = process.platform === 'darwin'

/**
 * Whether closing the main window should quit the app. Temporary until the
 * tray/menu-bar presence exists (Phase 4), after which the app keeps running.
 */
export function quitWhenMainWindowCloses(): boolean {
  return !isMac
}
