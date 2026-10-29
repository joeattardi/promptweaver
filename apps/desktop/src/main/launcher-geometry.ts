// Where the launcher goes and how tall it may be. Pure, so it can be tested without a screen.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const LAUNCHER_WIDTH = 640
/** Just the search box. */
export const LAUNCHER_MIN_HEIGHT = 64
/** The height before the page has measured itself. */
export const LAUNCHER_INITIAL_HEIGHT = 360
/** The window never grows past this, however long the form is; the form scrolls instead. */
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

/** Horizontally centered, near the top of the screen, and always fully on it. */
export function launcherBounds(workArea: Rect, height: number): Rect {
  const width = Math.min(LAUNCHER_WIDTH, workArea.width)
  const x = workArea.x + Math.round((workArea.width - width) / 2)
  const preferred = workArea.y + Math.round(workArea.height * TOP_FRACTION)
  const lowest = workArea.y + workArea.height - height - MARGIN
  const y = Math.max(workArea.y + MARGIN, Math.min(preferred, lowest))
  return { x, y, width, height }
}
