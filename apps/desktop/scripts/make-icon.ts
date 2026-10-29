// Draws the app icon (build/icon.png, 1024 x 1024): the woven mark from the menu-bar icon,
// in white on a rounded indigo tile. Run: node apps/desktop/scripts/make-icon.ts
// electron-builder turns the PNG into .icns / .ico, so only the PNG is kept.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodePng } from '../src/main/tray-icon.ts'

const SIZE = 1024
const TILE = 824 // macOS icon art leaves a margin inside the canvas
const MARGIN = (SIZE - TILE) / 2
const RADIUS_EXPONENT = 5 // superellipse: rounder than a rounded rectangle, like Apple's tiles
const SAMPLES = 2

// A 3 x 3 basket weave in a 100-unit square, centered on the tile and ~56% of its width.
const UNIT = (TILE * 0.56) / 100
const CENTERS = [21, 50, 79]
const HALF = 9 // half the bar thickness
const FROM = 4
const TO = 96
const ROUND = 5 // rounding of the bar ends
/** The cut left in the bar that passes under, each side of the one passing over. */
const GAP = 3.5

const within = (v: number, c: number, half: number): boolean => Math.abs(v - c) < half

/** Whether (u, v) is inside a bar running along `along` (0 = horizontal, 1 = vertical), with rounded ends. */
function inBarShape(u: number, v: number, vertical: boolean, center: number): boolean {
  const across = vertical ? u : v
  const along = vertical ? v : u
  if (!within(across, center, HALF)) return false
  const mid = (FROM + TO) / 2
  const endDistance = (TO - FROM) / 2 - Math.abs(along - mid)
  if (endDistance < 0) return false
  if (endDistance >= ROUND) return true
  // Near an end: the corners are quarter circles.
  const edge = HALF - Math.abs(across - center)
  if (edge >= ROUND) return true
  const dx = ROUND - Math.min(endDistance, edge)
  const dy = ROUND - Math.max(endDistance, edge)
  return endDistance >= ROUND || edge >= ROUND || dx * dx + dy * dy <= ROUND * ROUND
}

/** Vertical bar `col` passes over horizontal bar `row` where the sum is even. */
const verticalOver = (col: number, row: number): boolean => (col + row) % 2 === 0

function inWeave(u: number, v: number): boolean {
  const col = CENTERS.findIndex((c) => within(u, c, HALF))
  const row = CENTERS.findIndex((c) => within(v, c, HALF))
  const inV = col >= 0 && inBarShape(u, v, true, CENTERS[col] ?? 0)
  const inH = row >= 0 && inBarShape(u, v, false, CENTERS[row] ?? 0)
  if (inV && inH) return true
  if (inV) {
    // Cut the vertical bar beside each horizontal bar that passes over it.
    return !CENTERS.some(
      (c, r) => !verticalOver(col, r) && within(v, c, HALF + GAP) && !within(v, c, HALF)
    )
  }
  if (inH) {
    return !CENTERS.some(
      (c, k) => verticalOver(k, row) && within(u, c, HALF + GAP) && !within(u, c, HALF)
    )
  }
  return false
}

const rgba = Buffer.alloc(SIZE * SIZE * 4)

const mix = (a: number[], b: number[], t: number): number[] =>
  a.map((v, i) => v + ((b[i] ?? 0) - v) * t)
const TOP = [129, 140, 248] // indigo-400
const BOTTOM = [67, 56, 202] // indigo-700

function inTile(x: number, y: number): boolean {
  const nx = Math.abs((x - SIZE / 2) / (TILE / 2))
  const ny = Math.abs((y - SIZE / 2) / (TILE / 2))
  return nx ** RADIUS_EXPONENT + ny ** RADIUS_EXPONENT <= 1
}

function markAt(x: number, y: number): boolean {
  return inWeave((x - SIZE / 2) / UNIT + 50, (y - SIZE / 2) / UNIT + 50)
}

// Shadow: the mark seen from a few points around a spot a little below, averaged, so its edge is soft.
const SHADOW_OFFSETS = Array.from({ length: 12 }, (_, k) => {
  const angle = (k / 12) * Math.PI * 2
  return [Math.cos(angle) * 9, 16 + Math.sin(angle) * 9] as const
})
function shadowAt(x: number, y: number): number {
  let hits = 0
  for (const [dx, dy] of SHADOW_OFFSETS) if (markAt(x - dx, y - dy)) hits++
  return hits / SHADOW_OFFSETS.length
}

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let tile = 0
    let mark = 0
    let shadow = 0
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = px + (sx + 0.5) / SAMPLES
        const y = py + (sy + 0.5) / SAMPLES
        if (!inTile(x, y)) continue
        tile++
        if (markAt(x, y)) mark++
        shadow += shadowAt(x, y)
      }
    }
    const n = SAMPLES * SAMPLES
    if (tile === 0) continue
    const coverage = tile / n
    const t = Math.min(1, Math.max(0, (py - MARGIN) / TILE))
    let color = mix(TOP, BOTTOM, t)
    // A faint light edge at the top for depth.
    const edge = Math.max(0, 1 - (py - MARGIN) / 18) * 0.18
    color = mix(color, [255, 255, 255], edge)
    color = mix(color, [30, 27, 75], (shadow / n) * 0.4)
    color = mix(color, [255, 255, 255], mark / n)
    const o = (py * SIZE + px) * 4
    rgba[o] = Math.round(color[0] ?? 0)
    rgba[o + 1] = Math.round(color[1] ?? 0)
    rgba[o + 2] = Math.round(color[2] ?? 0)
    rgba[o + 3] = Math.round(coverage * 255)
  }
}

writeFileSync(join(import.meta.dirname, '..', 'build', 'icon.png'), encodePng(SIZE, SIZE, rgba))
console.log('Wrote build/icon.png')
