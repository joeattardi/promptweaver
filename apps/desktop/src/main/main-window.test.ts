import { describe, expect, it, vi } from 'vitest'
import { MainWindowController, type WindowHandle } from './main-window'

function setup() {
  const windows: ReturnType<typeof fakeWindow>[] = []
  const activateApp = vi.fn()
  const controller = new MainWindowController({
    create: (options) => {
      const win = fakeWindow(options.show)
      windows.push(win)
      return win
    },
    activateApp
  })
  return { controller, windows, activateApp }
}

function fakeWindow(shown: boolean) {
  let closed: () => void = () => undefined
  let minimized = false
  const win = {
    shownAtCreate: shown,
    sent: [] as [string, unknown][],
    shows: 0,
    focuses: 0,
    restores: 0,
    setMinimized: (value: boolean) => void (minimized = value),
    close: () => closed(),
    isMinimized: () => minimized,
    restore: () => {
      win.restores++
      minimized = false
    },
    show: () => void win.shows++,
    focus: () => void win.focuses++,
    send: (channel: string, payload: unknown) => void win.sent.push([channel, payload]),
    onClosed: (listener: () => void) => void (closed = listener)
  }
  return win satisfies WindowHandle & Record<string, unknown>
}

describe('MainWindowController', () => {
  it('creates the window on first open and holds the request until the page asks for it', () => {
    const { controller, windows, activateApp } = setup()
    controller.open({ selectId: 'review' })
    expect(windows).toHaveLength(1)
    expect(windows[0]?.shownAtCreate).toBe(true)
    // The page isn't ready to be messaged, so nothing is sent...
    expect(windows[0]?.sent).toEqual([])
    expect(activateApp).toHaveBeenCalled()
    // ...and it gets the request when it asks.
    expect(controller.takePending()).toEqual({ selectId: 'review' })
    expect(controller.takePending()).toEqual({})
  })

  it('merges requests made while the page is still loading', () => {
    const { controller } = setup()
    controller.open({ selectId: 'a' })
    controller.open({ openSettings: true })
    controller.open({ selectId: 'b' })
    expect(controller.takePending()).toEqual({ selectId: 'b', openSettings: true })
  })

  it('messages a window whose page is ready, and brings it forward', () => {
    const { controller, windows } = setup()
    controller.open()
    controller.takePending()
    const win = windows[0]
    controller.open({ selectId: 'review', openSettings: true, notice: 'Hello' })
    expect(win?.sent).toEqual([
      ['app:select-prompt', { id: 'review' }],
      ['app:open-settings', {}],
      ['app:notice', { message: 'Hello' }]
    ])
    expect(win?.shows).toBe(1)
    expect(win?.focuses).toBe(1)
    expect(windows).toHaveLength(1)
  })

  it('restores a minimized window', () => {
    const { controller, windows } = setup()
    controller.open()
    controller.takePending()
    windows[0]?.setMinimized(true)
    controller.open()
    expect(windows[0]?.restores).toBe(1)
  })

  it('creates a hidden window for a start at login, then shows that same window on open', () => {
    const { controller, windows } = setup()
    controller.createHidden()
    expect(windows[0]?.shownAtCreate).toBe(false)
    expect(controller.isOpen()).toBe(true)
    controller.open({ selectId: 'review' })
    // It never shows itself, so opening it must.
    expect(windows).toHaveLength(1)
    expect(windows[0]?.shows).toBe(1)
    expect(controller.takePending()).toEqual({ selectId: 'review' })
  })

  it('does not show a window twice that is already showing itself', () => {
    const { controller, windows } = setup()
    controller.open()
    controller.open()
    expect(windows[0]?.shows).toBe(0)
  })

  it('makes a new window after the old one is closed, with nothing left over', () => {
    const { controller, windows } = setup()
    controller.open({ selectId: 'old' })
    windows[0]?.close()
    expect(controller.isOpen()).toBe(false)
    controller.open({ selectId: 'new' })
    expect(windows).toHaveLength(2)
    expect(controller.takePending()).toEqual({ selectId: 'new' })
  })
})
