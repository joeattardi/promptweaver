import type { IpcEvent, IpcEventPayload, PendingAction } from '../shared/ipc'

/** The part of a BrowserWindow this needs, so it can be tested without Electron. */
export interface WindowHandle {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  send<E extends IpcEvent>(channel: E, payload: IpcEventPayload<E>): void
  /** Calls `listener` once, when the window is gone. */
  onClosed(listener: () => void): void
}

export interface MainWindowDeps {
  create: (options: { show: boolean }) => WindowHandle
  /** Brings the app to the front, for when it was in the background (macOS needs to be asked). */
  activateApp: () => void
}

/**
 * The main window: opened on demand, and told what to do when it opens ("show
 * this prompt", "show the settings"). A window that is still loading can't be
 * messaged yet, so the request waits until the page asks for it.
 */
export class MainWindowController {
  private handle: WindowHandle | null = null
  private ready = false
  /** True if the window shows itself once its page has painted; false if it was made hidden. */
  private showsItself = false
  private pending: PendingAction = {}

  constructor(private readonly deps: MainWindowDeps) {}

  isOpen(): boolean {
    return this.handle !== null
  }

  /** Creates the window if it doesn't exist (hidden, for a start at login) without showing it. */
  createHidden(): void {
    this.ensureWindow(false)
  }

  /** Shows the window, creating it if needed, and then does `action` in it. */
  open(action: PendingAction = {}): void {
    const handle = this.ensureWindow(true)
    // A window that shows itself when its page is painted is left to; any other is shown now.
    if (this.ready || !this.showsItself) {
      if (handle.isMinimized()) handle.restore()
      handle.show()
      handle.focus()
      this.showsItself = true
    }
    if (this.ready) this.deliver(handle, action)
    else this.pending = { ...this.pending, ...action }
    this.deps.activateApp()
  }

  /** The page calling in once it can handle messages. Hands over everything that was waiting. */
  takePending(): PendingAction {
    this.ready = true
    const action = this.pending
    this.pending = {}
    return action
  }

  // ---------------------------------------------------------------------------

  private ensureWindow(show: boolean): WindowHandle {
    if (this.handle !== null) return this.handle
    const handle = this.deps.create({ show })
    this.handle = handle
    this.ready = false
    this.showsItself = show
    this.pending = {}
    handle.onClosed(() => {
      if (this.handle === handle) {
        this.handle = null
        this.ready = false
        this.pending = {}
      }
    })
    return handle
  }

  private deliver(handle: WindowHandle, action: PendingAction): void {
    if (action.selectId !== undefined) handle.send('app:select-prompt', { id: action.selectId })
    if (action.openSettings) handle.send('app:open-settings', {})
    if (action.notice !== undefined) handle.send('app:notice', { message: action.notice })
  }
}
