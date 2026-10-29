import { describe, expect, it } from 'vitest'
import {
  clampLauncherHeight,
  LAUNCHER_MAX_HEIGHT,
  LAUNCHER_MIN_HEIGHT,
  LAUNCHER_PAD,
  LAUNCHER_WIDTH,
  LAUNCHER_WINDOW_WIDTH,
  launcherBounds
} from './launcher-geometry'

const screen = { x: 0, y: 0, width: 1920, height: 1080 }

describe('launcherBounds', () => {
  it('centers the panel horizontally and puts it in the upper part of the screen', () => {
    // The window reaches LAUNCHER_PAD past the panel on every side.
    expect(launcherBounds(screen, 300)).toEqual({
      x: 640 - LAUNCHER_PAD,
      y: 194 - LAUNCHER_PAD,
      width: LAUNCHER_WINDOW_WIDTH,
      height: 300 + 2 * LAUNCHER_PAD
    })
  })

  it('keeps the panel, not the window, centered', () => {
    const bounds = launcherBounds(screen, 300)
    expect(bounds.x + LAUNCHER_PAD + LAUNCHER_WIDTH / 2).toBe(screen.width / 2)
  })

  it('follows a display that is not at the origin, including one to the left', () => {
    const second = { x: -1440, y: 120, width: 1440, height: 900 }
    const bounds = launcherBounds(second, 300)
    expect(bounds.x + LAUNCHER_PAD).toBe(-1440 + 400)
    expect(bounds.y + LAUNCHER_PAD).toBe(120 + 162)
  })

  it('moves up so a tall panel stays on a short screen', () => {
    const short = { x: 0, y: 0, width: 1280, height: 720 }
    const bounds = launcherBounds(short, 640)
    const panelTop = bounds.y + LAUNCHER_PAD
    expect(panelTop + 640).toBeLessThanOrEqual(720 - 24)
    expect(panelTop).toBeGreaterThanOrEqual(24)
  })

  it('shrinks the panel to a narrow screen', () => {
    expect(launcherBounds({ x: 0, y: 0, width: 500, height: 800 }, 200)).toMatchObject({
      x: -LAUNCHER_PAD,
      width: 500 + 2 * LAUNCHER_PAD
    })
  })
})

describe('clampLauncherHeight', () => {
  it('rounds up to whole pixels', () => {
    expect(clampLauncherHeight(200.2, screen)).toBe(201)
  })

  it('keeps at least the search box and at most the maximum', () => {
    expect(clampLauncherHeight(0, screen)).toBe(LAUNCHER_MIN_HEIGHT)
    expect(clampLauncherHeight(5000, screen)).toBe(LAUNCHER_MAX_HEIGHT)
  })

  it('never exceeds a small screen', () => {
    expect(clampLauncherHeight(5000, { x: 0, y: 0, width: 800, height: 500 })).toBe(452)
  })

  it('treats nonsense as the smallest size', () => {
    expect(clampLauncherHeight(Number.NaN, screen)).toBe(LAUNCHER_MIN_HEIGHT)
    expect(clampLauncherHeight(-10, screen)).toBe(LAUNCHER_MIN_HEIGHT)
  })
})
