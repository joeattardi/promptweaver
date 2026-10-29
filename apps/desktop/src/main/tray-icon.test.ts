import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { weaveIconPng } from './tray-icon'

/** Reads back the alpha channel of a PNG written by `weaveIconPng`. */
function alphaOf(png: Buffer): { size: number; alpha: number[][] } {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const size = png.readUInt32BE(16)
  expect(png.readUInt32BE(20)).toBe(size)
  expect(png[24]).toBe(8)
  expect(png[25]).toBe(6)
  let offset = 8
  const data: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const raw = inflateSync(Buffer.concat(data))
  const stride = size * 4 + 1
  const alpha = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => raw[y * stride + 1 + x * 4 + 3] ?? -1)
  )
  return { size, alpha }
}

describe('weaveIconPng', () => {
  it('is a valid PNG of the requested size', () => {
    expect(alphaOf(weaveIconPng(36)).size).toBe(36)
    expect(alphaOf(weaveIconPng(18)).size).toBe(18)
  })

  it('draws something, with an empty margin and soft edges', () => {
    const { alpha } = alphaOf(weaveIconPng(36))
    const flat = alpha.flat()
    expect(flat.some((a) => a === 255)).toBe(true)
    expect(flat.some((a) => a === 0)).toBe(true)
    expect(alpha[0]?.every((a) => a === 0)).toBe(true)
    expect(alpha.every((row) => row[0] === 0)).toBe(true)
  })

  it('is a weave: each bar is cut next to the bar that crosses over it', () => {
    const { alpha } = alphaOf(weaveIconPng(36))
    const at = (x: number, y: number): number => alpha[y]?.[x] ?? -1
    // Where bars cross the crossing is solid.
    expect(at(12, 12)).toBe(255)
    expect(at(24, 24)).toBe(255)
    // Along the first horizontal bar (rows 9-14) just right of the first vertical bar (cols 9-14) is a cut...
    expect(at(16, 12)).toBe(255 - 255)
    // ...and the same place along the second horizontal bar is solid.
    expect(at(16, 24)).toBe(255)
  })
})
