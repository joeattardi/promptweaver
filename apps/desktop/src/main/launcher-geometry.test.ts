import { describe, expect, it } from 'vitest'
import {
  clampLauncherHeight,
  LAUNCHER_MAX_HEIGHT,
  LAUNCHER_MIN_HEIGHT,
  LAUNCHER_WIDTH,
  launcherBounds
} from './launcher-geometry'

const screen = { x: 0, y: 0, width: 1920, height: 1080 }

describe('launcherBounds', () => {
  it('centers horizontally and sits in the upper part of the screen', () => {
    expect(launcherBounds(screen, 300)).toEqual({
      x: 640,
      y: 194,
      width: LAUNCHER_WIDTH,
      height: 300
    })
  })

  it('follows a display that is not at the origin, including one to the left', () => {
    const second = { x: -1440, y: 120, width: 1440, height: 900 }
    const bounds = launcherBounds(second, 300)
    expect(bounds.x).toBe(-1440 + 400)
    expect(bounds.y).toBe(120 + 162)
  })

  it('moves up so a tall window stays on a short screen', () => {
    const short = { x: 0, y: 0, width: 1280, height: 720 }
    const bounds = launcherBounds(short, 640)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(720 - 24)
    expect(bounds.y).toBeGreaterThanOrEqual(24)
  })

  it('shrinks to a narrow screen', () => {
    expect(launcherBounds({ x: 0, y: 0, width: 500, height: 800 }, 200)).toMatchObject({
      x: 0,
      width: 500
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
