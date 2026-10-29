// Where the launcher goes and how tall it may be. Pure, so it can be tested without a screen.
//
// The window is transparent and larger than the panel on every side: the extra room (LAUNCHER_PAD)
// holds the panel's soft shadow and lets it scale and fade without being cut off. "Height" below
// means the panel's; the window adds the padding.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The panel's width. */
export const LAUNCHER_WIDTH = 640
/** Room around the panel inside the window, for its shadow and its motion. */
export const LAUNCHER_PAD = 28
export const LAUNCHER_WINDOW_WIDTH = LAUNCHER_WIDTH + 2 * LAUNCHER_PAD
/** Just the search box. */
export const LAUNCHER_MIN_HEIGHT = 64
/** The panel's height before the page has measured itself. */
export const LAUNCHER_INITIAL_HEIGHT = 360
/** The panel never grows past this, however long the form is; the form scrolls instead. */
export const LAUNCHER_MAX_HEIGHT = 640

/** Space kept between the launcher and the edges of the screen. */
const MARGIN = 24
/** How far down the screen the top edge sits, like Spotlight. */
const TOP_FRACTION = 0.18

/** The height to use for what the page asked for: whole pixels, within the limits and the screen. */
export function clampLauncherHeight(requested: number, workArea: Rect): number {
  const ceiling = Math.min(
    LAUNCHER_MAX_HEIGHT,
    Math.max(LAUNCHER_MIN_HEIGHT, workArea.height - 2 * MARGIN)
  )
  const wanted = Number.isFinite(requested) ? Math.ceil(requested) : LAUNCHER_MIN_HEIGHT
  return Math.max(LAUNCHER_MIN_HEIGHT, Math.min(ceiling, wanted))
}

/**
 * The window for a panel of this height: the panel horizontally centered, near the top of the
 * screen, and always fully on it. The window extends LAUNCHER_PAD beyond the panel on every side.
 */
export function launcherBounds(workArea: Rect, panelHeight: number): Rect {
  const panelWidth = Math.min(LAUNCHER_WIDTH, workArea.width)
  const x = workArea.x + Math.round((workArea.width - panelWidth) / 2)
  const preferred = workArea.y + Math.round(workArea.height * TOP_FRACTION)
  const lowest = workArea.y + workArea.height - panelHeight - MARGIN
  const y = Math.max(workArea.y + MARGIN, Math.min(preferred, lowest))
  return {
    x: x - LAUNCHER_PAD,
    y: y - LAUNCHER_PAD,
    width: panelWidth + 2 * LAUNCHER_PAD,
    height: panelHeight + 2 * LAUNCHER_PAD
  }
}
