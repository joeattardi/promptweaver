import { describe, expect, it, vi } from 'vitest'
import { createFakeShortcuts } from './test-hooks'

describe('createFakeShortcuts', () => {
  it('runs the callback registered for the pressed accelerator', () => {
    const { shortcuts, press } = createFakeShortcuts([])
    const callback = vi.fn()
    expect(shortcuts.register('Control+Alt+K', callback)).toBe(true)
    expect(press('Control+Alt+K')).toBe(true)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a shortcut nobody registered or that was released', () => {
    const { shortcuts, press } = createFakeShortcuts([])
    const callback = vi.fn()
    shortcuts.register('Control+Alt+K', callback)
    shortcuts.unregister('Control+Alt+K')
    expect(press('Control+Alt+K')).toBe(false)
    expect(press('Control+Alt+J')).toBe(false)
    expect(callback).not.toHaveBeenCalled()
  })

  it('refuses the shortcuts it was told another app holds', () => {
    const { shortcuts } = createFakeShortcuts(['Control+Alt+Space'])
    expect(shortcuts.register('Control+Alt+Space', vi.fn())).toBe(false)
    expect(shortcuts.isRegistered('Control+Alt+Space')).toBe(false)
  })
})
