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
