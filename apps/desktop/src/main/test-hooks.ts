import type { BrowserWindow } from 'electron'
import type { ShortcutApi } from './hotkey'

/**
 * Only used when the app is started with PROMPTWEAVER_TEST_HOOKS=1, by the
 * end-to-end tests. They can't press a real global shortcut, and must not take
 * the real one from the developer running them, so shortcuts are kept in memory
 * and a test "presses" one through `press`.
 */
export function createFakeShortcuts(taken: readonly string[]): {
  shortcuts: ShortcutApi
  /** Calls the callback registered for the accelerator. Returns whether there was one. */
  press: (accelerator: string) => boolean
} {
  const registered = new Map<string, () => void>()
  return {
    shortcuts: {
      register: (accelerator, callback) => {
        if (taken.includes(accelerator)) return false
        registered.set(accelerator, callback)
        return true
      },
      unregister: (accelerator) => void registered.delete(accelerator),
      isRegistered: (accelerator) => registered.has(accelerator)
    },
    press: (accelerator) => {
      const callback = registered.get(accelerator)
      callback?.()
      return callback !== undefined
    }
  }
}

/**
 * For end-to-end runs on a real desktop: keeps a window from flashing on screen or taking focus.
 * It still counts as shown (`isVisible()` is true, pages render and take input), but it is fully
 * transparent, clicks go through it, and showing or focusing it never activates the app.
 * Set PROMPTWEAVER_TEST_HIDDEN=1 (with PROMPTWEAVER_TEST_HOOKS=1); the tests' launcher does so
 * unless SHOW_E2E_WINDOWS=1 is set to watch them.
 */
export function makeUnobtrusive(win: BrowserWindow): void {
  win.setOpacity(0)
  win.setIgnoreMouseEvents(true)
  win.show = () => win.showInactive()
  win.focus = () => undefined
}
