import { describe, expect, it } from 'vitest'
import {
  checkAccelerator,
  clashWarning,
  DEFAULT_LAUNCHER_HOTKEY,
  formatAccelerator,
  parseAccelerator,
  recordAccelerator,
  type KeyEventLike
} from './accelerator'

function press(code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    code,
    key: code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  }
}

describe('parseAccelerator', () => {
  it('normalizes aliases, case and modifier order', () => {
    expect(parseAccelerator('cmd+option+k')).toEqual({ modifiers: ['Alt', 'Command'], key: 'K' })
    expect(parseAccelerator('Shift+Ctrl+space')).toEqual({
      modifiers: ['Control', 'Shift'],
      key: 'Space'
    })
  })

  it('accepts function keys, arrows and punctuation', () => {
    expect(parseAccelerator('Control+F12')?.key).toBe('F12')
    expect(parseAccelerator('Alt+left')?.key).toBe('Left')
    expect(parseAccelerator('Alt+;')?.key).toBe(';')
  })

  it.each(['', 'Space', 'Control+', 'Hyper+K', 'Control+F25', 'Control+Escape', 'Control+Shift'])(
    'rejects %j',
    (text) => {
      expect(parseAccelerator(text)).toBeNull()
    }
  )

  it('does not accept the platform-dependent CommandOrControl alias', () => {
    // It would make the saved shortcut mean different things on different machines.
    expect(parseAccelerator('CommandOrControl+K')).toBeNull()
  })
})

describe('checkAccelerator', () => {
  it('returns the canonical form', () => {
    expect(checkAccelerator('option+ctrl+space')).toEqual({
      ok: true,
      accelerator: 'Control+Alt+Space'
    })
  })

  it('requires a modifier other than Shift, and says so', () => {
    expect(checkAccelerator('Shift+K')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Include')
    })
    expect(checkAccelerator('K')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Include')
    })
  })

  it('says a non-shortcut is not one', () => {
    expect(checkAccelerator('Hyper+K')).toEqual({
      ok: false,
      reason: 'That is not a shortcut this app can use.'
    })
  })

  it('accepts the default', () => {
    expect(checkAccelerator(DEFAULT_LAUNCHER_HOTKEY)).toEqual({
      ok: true,
      accelerator: DEFAULT_LAUNCHER_HOTKEY
    })
  })
})

describe('clashWarning', () => {
  it('warns about Spotlight on macOS only', () => {
    expect(clashWarning('Command+Space', 'darwin')).toMatch(/Spotlight/)
    expect(clashWarning('Command+Space', 'linux')).toBeNull()
  })

  it('warns about command palettes everywhere', () => {
    expect(clashWarning('Control+Shift+P', 'win32')).toMatch(/command palette/)
  })

  it('has nothing to say about the default', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(clashWarning(DEFAULT_LAUNCHER_HOTKEY, platform)).toBeNull()
    }
  })
})

describe('recordAccelerator', () => {
  it('waits while only modifiers are held', () => {
    expect(recordAccelerator(press('ControlLeft', { ctrlKey: true }), 'darwin')).toEqual({
      status: 'pending',
      modifiers: ['Control']
    })
  })

  it('records the physical key, not the character, so Option+letter works on macOS', () => {
    const event = { ...press('KeyK', { altKey: true, ctrlKey: true }), key: '˚' }
    expect(recordAccelerator(event, 'darwin')).toEqual({
      status: 'ok',
      accelerator: 'Control+Alt+K'
    })
  })

  it('maps the meta key to Command on macOS and Super elsewhere', () => {
    expect(recordAccelerator(press('Space', { metaKey: true, shiftKey: true }), 'darwin')).toEqual({
      status: 'ok',
      accelerator: 'Shift+Command+Space'
    })
    expect(recordAccelerator(press('Space', { metaKey: true, ctrlKey: true }), 'linux')).toEqual({
      status: 'ok',
      accelerator: 'Control+Super+Space'
    })
  })

  it('rejects a bare key and says why', () => {
    expect(recordAccelerator(press('KeyK'), 'darwin')).toMatchObject({ status: 'rejected' })
  })

  it('rejects keys it cannot express', () => {
    expect(recordAccelerator(press('Escape', { ctrlKey: true }), 'darwin')).toMatchObject({
      status: 'rejected'
    })
  })

  it('records digits, arrows and function keys', () => {
    expect(recordAccelerator(press('Digit7', { altKey: true }), 'darwin')).toMatchObject({
      accelerator: 'Alt+7'
    })
    expect(recordAccelerator(press('ArrowUp', { ctrlKey: true }), 'darwin')).toMatchObject({
      accelerator: 'Control+Up'
    })
    expect(recordAccelerator(press('F5', { altKey: true }), 'darwin')).toMatchObject({
      accelerator: 'Alt+F5'
    })
  })
})

describe('formatAccelerator', () => {
  it('uses symbols on macOS', () => {
    expect(formatAccelerator('Control+Alt+Space', 'darwin')).toBe('⌃⌥Space')
    expect(formatAccelerator('Shift+Command+Up', 'darwin')).toBe('⇧⌘↑')
  })

  it('spells modifiers out elsewhere', () => {
    expect(formatAccelerator('Control+Alt+Space', 'win32')).toBe('Ctrl+Alt+Space')
    expect(formatAccelerator('Control+Super+K', 'win32')).toBe('Ctrl+Win+K')
    expect(formatAccelerator('Control+Super+K', 'linux')).toBe('Ctrl+Super+K')
  })

  it('shows unparseable text as written', () => {
    expect(formatAccelerator('nonsense', 'darwin')).toBe('nonsense')
  })
})
