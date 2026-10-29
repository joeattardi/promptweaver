import { describe, expect, it, vi } from 'vitest'
import { HotkeyManager, type ShortcutApi } from './hotkey'

function fakeShortcuts(taken: string[] = []) {
  const registered = new Map<string, () => void>()
  const api: ShortcutApi & { registered: Map<string, () => void> } = {
    registered,
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (taken.includes(accelerator)) return false
      registered.set(accelerator, callback)
      return true
    }),
    unregister: vi.fn((accelerator: string) => void registered.delete(accelerator)),
    isRegistered: (accelerator: string) => registered.has(accelerator)
  }
  return api
}

describe('HotkeyManager', () => {
  it('registers a shortcut that calls back when pressed', () => {
    const shortcuts = fakeShortcuts()
    const onPress = vi.fn()
    const hotkey = new HotkeyManager(shortcuts, onPress, 'darwin')
    expect(hotkey.apply('Control+Alt+Space')).toEqual({
      ok: true,
      accelerator: 'Control+Alt+Space'
    })
    expect(hotkey.status()).toEqual({ registered: true, error: null })
    shortcuts.registered.get('Control+Alt+Space')?.()
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('normalizes the accelerator before registering it', () => {
    const shortcuts = fakeShortcuts()
    const hotkey = new HotkeyManager(shortcuts, vi.fn(), 'darwin')
    hotkey.apply('option+ctrl+space')
    expect([...shortcuts.registered.keys()]).toEqual(['Control+Alt+Space'])
    expect(hotkey.accelerator).toBe('Control+Alt+Space')
  })

  it('says so when a shortcut is taken, naming it the way the platform shows it', () => {
    const hotkey = new HotkeyManager(fakeShortcuts(['Control+Alt+Space']), vi.fn(), 'darwin')
    const result = hotkey.apply('Control+Alt+Space')
    expect(result).toMatchObject({ ok: false })
    expect(result.ok ? '' : result.error).toContain('⌃⌥Space')
    // Nothing is registered, and the status says why, so the main window can tell the user.
    expect(hotkey.status().registered).toBe(false)
    expect(hotkey.status().error).toContain('already used')
  })

  it('switches to a new shortcut and releases the old one', () => {
    const shortcuts = fakeShortcuts()
    const hotkey = new HotkeyManager(shortcuts, vi.fn(), 'darwin')
    hotkey.apply('Control+Alt+Space')
    expect(hotkey.apply('Control+Alt+K')).toEqual({ ok: true, accelerator: 'Control+Alt+K' })
    expect([...shortcuts.registered.keys()]).toEqual(['Control+Alt+K'])
  })

  it('keeps the old shortcut when the new one is taken', () => {
    const shortcuts = fakeShortcuts(['Control+Alt+K'])
    const hotkey = new HotkeyManager(shortcuts, vi.fn(), 'darwin')
    hotkey.apply('Control+Alt+Space')
    expect(hotkey.apply('Control+Alt+K')).toMatchObject({ ok: false })
    expect([...shortcuts.registered.keys()]).toEqual(['Control+Alt+Space'])
    expect(hotkey.accelerator).toBe('Control+Alt+Space')
    // The old shortcut still works, so the status doesn't claim a problem.
    expect(hotkey.status()).toEqual({ registered: true, error: null })
  })

  it('recovers once a working shortcut is chosen after a failed start', () => {
    const hotkey = new HotkeyManager(fakeShortcuts(['Control+Alt+Space']), vi.fn(), 'darwin')
    hotkey.apply('Control+Alt+Space')
    expect(hotkey.status().registered).toBe(false)
    expect(hotkey.apply('Control+Alt+K')).toMatchObject({ ok: true })
    expect(hotkey.status()).toEqual({ registered: true, error: null })
  })

  it('refuses shortcuts that would fire while typing, without touching the system', () => {
    const shortcuts = fakeShortcuts()
    const hotkey = new HotkeyManager(shortcuts, vi.fn(), 'darwin')
    expect(hotkey.apply('K')).toMatchObject({ ok: false })
    expect(hotkey.apply('Shift+K')).toMatchObject({ ok: false })
    expect(hotkey.apply('nonsense')).toMatchObject({ ok: false })
    expect(shortcuts.register).not.toHaveBeenCalled()
  })

  it('treats a throw from the system as "cannot use that"', () => {
    const shortcuts = fakeShortcuts()
    shortcuts.register = vi.fn(() => {
      throw new Error('bad accelerator')
    })
    const hotkey = new HotkeyManager(shortcuts, vi.fn(), 'darwin')
    expect(hotkey.apply('Control+Alt+K')).toMatchObject({ ok: false })
  })

  it('does nothing when asked for the shortcut it already has', () => {
    const shortcuts = fakeShortcuts()
    const hotkey = new HotkeyManager(shortcuts, vi.fn(), 'darwin')
    hotkey.apply('Control+Alt+Space')
    hotkey.apply('Control+Alt+Space')
    expect(shortcuts.register).toHaveBeenCalledTimes(1)
  })

  it('releases the shortcut on dispose', () => {
    const shortcuts = fakeShortcuts()
    const hotkey = new HotkeyManager(shortcuts, vi.fn(), 'darwin')
    hotkey.apply('Control+Alt+Space')
    hotkey.dispose()
    expect(shortcuts.registered.size).toBe(0)
    expect(hotkey.status().registered).toBe(false)
  })
})
