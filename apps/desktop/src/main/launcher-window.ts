import { type BrowserWindow, screen } from 'electron'
import type { LauncherSuggestions, LauncherSummon } from '../shared/ipc'
import {
  clampLauncherHeight,
  LAUNCHER_INITIAL_HEIGHT,
  launcherBounds,
  type Rect
} from './launcher-geometry'
import { hideLauncherWindow, showLauncherWindow } from './platform'

export interface LauncherDeps {
  /** What to show before anything is typed. Cached, so this is cheap. */
  suggestions: () => LauncherSuggestions
  /** The clipboard text. Called at the moment of the hotkey, before the window takes focus. */
  readClipboard: () => Promise<string>
  /** Report timings (the first paint reported by the page, and how long main took). */
  measure: boolean
  log: (message: string) => void
}

/**
 * A blur this soon after showing is the window system settling, not the user
 * clicking away. Without this the launcher can hide itself as it appears.
 */
const BLUR_GRACE_MS = 200

/** How long the hotkey waits for the clipboard before showing the launcher without it. */
const CLIPBOARD_TIMEOUT_MS = 150

/**
 * Shows, hides and positions the launcher window, which is created once at
 * startup and never destroyed. Everything on the hotkey path is synchronous
 * and does as little as it can: the page is already loaded and drawn.
 */
export class LauncherController {
  private height = LAUNCHER_INITIAL_HEIGHT
  private shownAt = 0
  private summoning = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly deps: LauncherDeps
  ) {
    win.on('blur', () => {
      if (Date.now() - this.shownAt > BLUR_GRACE_MS) this.hide()
    })
    // However it was hidden, tell the page, so the next show starts at the search step.
    win.on('hide', () => {
      if (!win.webContents.isDestroyed()) win.webContents.send('launcher:hidden', {})
    })
  }

  get window(): BrowserWindow {
    return this.win
  }

  isVisible(): boolean {
    return this.win.isVisible()
  }

  /** The hotkey: show the launcher, or hide it if it is already up. */
  toggle(): void {
    if (this.isVisible()) this.hide()
    else void this.summon()
  }

  /** Shows the launcher, centered on the display the cursor is on. */
  async summon(): Promise<void> {
    // A second press while the first is still on its way up would show it twice.
    if (this.summoning || this.isVisible()) return
    this.summoning = true
    try {
      const started = Date.now()
      // The read starts now, before the window takes focus, so it is what the user had just copied.
      const clipboard = await this.readClipboard()
      const read = Date.now()
      const area = workAreaAtCursor()
      this.win.setBounds(launcherBounds(area, clampLauncherHeight(this.height, area)))

      const summon: LauncherSummon = {
        clipboard,
        suggestions: this.deps.suggestions(),
        pressedAt: this.deps.measure ? started : null
      }
      this.win.webContents.send('launcher:summon', summon)
      this.shownAt = Date.now()
      showLauncherWindow(this.win)
      // The page keeps rendering while hidden, so it can't tell when it was shown: say so now.
      // (Electron's own 'show' event arrives late, and not at all if the window is hidden again quickly.)
      if (this.deps.measure) this.win.webContents.send('launcher:shown', {})
      if (this.deps.measure) {
        const done = Date.now()
        this.deps.log(
          `[perf] hotkey → window shown: ${done - started} ms (clipboard ${read - started} ms)`
        )
      }
    } finally {
      this.summoning = false
    }
  }

  private async readClipboard(): Promise<string> {
    const timeout = new Promise<string>((resolve) =>
      setTimeout(() => resolve(''), CLIPBOARD_TIMEOUT_MS)
    )
    // A clipboard that can't be read is the same as an empty one: the launcher still opens.
    return Promise.race([this.deps.readClipboard().catch(() => ''), timeout])
  }

  hide(): void {
    if (!this.isVisible()) return
    hideLauncherWindow(this.win)
  }

  /** Fits the window to the page's content, keeping its top edge where it is. */
  resize(requested: number): void {
    const area = workAreaAtCursor(this.win.getBounds())
    const height = clampLauncherHeight(requested, area)
    this.height = height
    const bounds = this.win.getBounds()
    if (bounds.height === height) return
    this.win.setBounds({ ...bounds, height })
  }

  /** Tells the page the library or the favorites changed while it is open. */
  pushSuggestions(): void {
    if (this.win.webContents.isDestroyed()) return
    this.win.webContents.send('launcher:suggestions', this.deps.suggestions())
  }

  /** The page reporting how long it took from the hotkey to its first painted frame. */
  recordPaint(milliseconds: number): void {
    if (!this.deps.measure || !Number.isFinite(milliseconds)) return
    this.deps.log(`[perf] hotkey → first paint: ${Math.round(milliseconds)} ms`)
  }
}

/** The usable area of the display with the cursor on it (or the one holding `near`). */
function workAreaAtCursor(near?: Rect): Rect {
  const display = near
    ? screen.getDisplayMatching(near)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return display.workArea
}
